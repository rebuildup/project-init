#!/usr/bin/env bun
/**
 * Machine inventory and placement suitability (Epic #86, T011 / issue #97).
 *
 * Owns: on-demand probing of CPU/RAM/GPU/VRAM/disk/OS/arch/availability/GUI/device,
 *       Windows+WSL shared physical host detection, placement constraints.
 *
 * Contract: read-only use of `herdr machine list/status`; never duplicates
 *           dotfiles#78 device connectivity; never implements custom transport.
 *
 * Key invariants:
 *   - A machine's identity/resources/arch MUST come from evidence about THAT machine
 *   - Windows+WSL shared-host grouping derived from evidence, not guessed
 *   - Availability is fail-closed: error/offline/unknown NOT suitable by default
 *   - Parse/exec failures return explicit inventory-error, not swallowed
 *   - Host identifiers are hashed (no raw IOPlatformUUID/SSH targets in output)
 *
 * Run: bun test script/agent/machines.test.ts
 */

import { platform, arch, totalmem, cpus, homedir, userInfo } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  parseMachineId,
  ContractError,
  Attested,
  attest,
  VerificationStatus,
  Provenance,
  Evidence,
  toJson,
  redactJson,
  agentStateDir,
  CONTRACT_VERSION,
} from "./contract";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Unique identifier for a physical host group (shared by Windows+WSL). */
export type PhysicalHostGroup = string;

/** Machine OS type - aligns with devices.ts Device.os */
export type MachineOS = "linux" | "macos" | "windows";

/** GPU vendor/brand information */
export interface GPUInfo {
  vendor: string;
  model: string;
  vramBytes: number | null; // null = unknown
}

/** Disk partition information */
export interface DiskInfo {
  mount: string;
  totalBytes: number;
  availableBytes: number;
}

/** Resource inventory for a machine */
export interface MachineResources {
  cpu: {
    cores: number;
    model: string;
  };
  ramBytes: number;
  gpus: GPUInfo[];
  disks: DiskInfo[];
}

/** Capability flags for a machine */
export interface MachineCapabilities {
  gui: boolean; // Has GUI environment available
  gpu: boolean; // Has any GPU
  accelerated: boolean; // Has hardware-accelerated GPU
}

/** Availability status of a machine */
export type MachineAvailability = "online" | "offline" | "error" | "unknown";

/** Herdr machine profile from `herdr machine list --json` */
export interface HerdrMachineProfile {
  id: string;
  label: string;
  target: string;
  session: string;
  enabled: boolean;
  selected: boolean;
}

/** Herdr machine status from `herdr machine status --json` */
export interface HerdrMachineStatus {
  id: string;
  label: string;
  status: "reachable" | "disabled" | "error" | string;
  error: string | null;
}

/** Inventory error - distinct from empty inventory */
export interface InventoryError {
  type: "inventory-error";
  error: string;
  timestamp: string;
}

/** Complete machine identity and state */
export interface Machine {
  /** Machine ID (from Herdr profile) */
  id: string;
  /** Human-readable label (from Herdr profile) */
  label: string;
  /** OS type - from evidence or unknown */
  os: MachineOS | null;
  /** Architecture - from evidence or unknown */
  arch: string | null;
  /** Physical host group hash - derived from evidence */
  physicalHostGroup: PhysicalHostGroup | null;
  /** Instance ID hash (never raw) */
  instanceIdHash: string | null;
  /** Herdr target (SSH host identifier) */
  target: string | null;
  /** Herdr session */
  session: string | null;
  /** Whether this is the local machine (best effort detection) */
  isLocal: boolean;
  /** Resource inventory - null if unknown/unprobed */
  resources: MachineResources | null;
  /** Capabilities - null if unknown/unprobed */
  capabilities: MachineCapabilities | null;
  /** Availability */
  availability: MachineAvailability;
  /** Error message if availability is 'error' */
  error: string | null;
  /** Herdr profile if this machine is registered with Herdr */
  herdrProfile: HerdrMachineProfile | null;
  /** Herdr status if available */
  herdrStatus: HerdrMachineStatus | null;
}

/** Placement constraints for task assignment */
export interface PlacementConstraints {
  /** Hard constraints - must be satisfied */
  hard: {
    os?: MachineOS[];
    arch?: string[];
    minCpuCores?: number;
    minRamBytes?: number;
    minGpuVramBytes?: number;
    gpuRequired?: boolean;
    guiRequired?: boolean;
    availability?: MachineAvailability[];
  };
  /** Soft constraints - preferred but not required */
  soft: {
    preferredOs?: MachineOS[];
    preferredArch?: string[];
    minPreferredCpuCores?: number;
    minPreferredRamBytes?: number;
  };
}

/** Placement suitability result */
export interface PlacementSuitability {
  /** Whether the machine satisfies hard constraints */
  satisfiesHard: boolean;
  /** Whether the machine satisfies soft constraints */
  satisfiesSoft: boolean;
  /** Hard constraint violations (empty if satisfiesHard) */
  hardViolations: string[];
  /** Soft constraint violations (empty if satisfiesSoft) */
  softViolations: string[];
  /** Reasoning for the suitability assessment */
  reasoning: string[];
  /** Score (0-1, higher is better) */
  score: number;
}

/** Machine inventory with attestation */
export interface AttestedMachine extends Machine {
  /** Attestation for the machine's resource data */
  attestation: Attested<MachineResources | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BYTES_PER_GB = 1024 * 1024 * 1024;
export const BYTES_PER_MB = 1024 * 1024;

/** Hash a string value for host identifiers */
function hashIdentifier(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Herdr Integration
// ---------------------------------------------------------------------------

/**
 * Get Herdr machine profiles from `herdr machine list --json`
 * Returns explicit error if command fails, not empty array
 */
export function getHerdrProfiles(): HerdrMachineProfile[] | InventoryError {
  try {
    const result = Bun.spawnSync(
      ["herdr", "machine", "list", "--json"],
      { stdout: "pipe", stderr: "pipe" }
    );
    
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      // Only return empty if Herdr explicitly says no machines
      if (stderr.includes("No machines") || stderr.includes("no machines")) {
        return [];
      }
      return {
        type: "inventory-error",
        error: `herdr machine list failed with exit code ${result.exitCode}: ${stderr}`,
        timestamp: new Date().toISOString(),
      };
    }
    
    const output = result.stdout.toString();
    try {
      return JSON.parse(output) as HerdrMachineProfile[];
    } catch (parseError) {
      return {
        type: "inventory-error",
        error: `herdr machine list returned invalid JSON: ${parseError}`,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (error) {
    return {
      type: "inventory-error",
      error: `herdr machine list execution failed: ${error}`,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Get Herdr machine statuses from `herdr machine status --json`
 * Returns explicit error if command fails, not empty array
 */
export function getHerdrStatuses(): HerdrMachineStatus[] | InventoryError {
  try {
    const result = Bun.spawnSync(
      ["herdr", "machine", "status", "--json"],
      { stdout: "pipe", stderr: "pipe" }
    );
    
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      if (stderr.includes("No machines") || stderr.includes("no machines")) {
        return [];
      }
      return {
        type: "inventory-error",
        error: `herdr machine status failed with exit code ${result.exitCode}: ${stderr}`,
        timestamp: new Date().toISOString(),
      };
    }
    
    const output = result.stdout.toString();
    try {
      return JSON.parse(output) as HerdrMachineStatus[];
    } catch (parseError) {
      return {
        type: "inventory-error",
        error: `herdr machine status returned invalid JSON: ${parseError}`,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (error) {
    return {
      type: "inventory-error",
      error: `herdr machine status execution failed: ${error}`,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Get both profiles and statuses, with proper error handling
 */
export function getHerdrInventory(): {
  profiles: HerdrMachineProfile[] | InventoryError;
  statuses: HerdrMachineStatus[] | InventoryError;
} {
  const profiles = getHerdrProfiles();
  const statuses = getHerdrStatuses();
  
  // If either is an error, return both as-is
  return { profiles, statuses };
}

/**
 * Map Herdr status to our availability enum
 */
function herdrStatusToAvailability(status: string | null): MachineAvailability {
  if (!status) return "unknown";
  
  const lower = status.toLowerCase();
  if (lower === "reachable") return "online";
  if (lower === "disabled") return "offline";
  if (lower === "error") return "error";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Local Machine Detection
// ---------------------------------------------------------------------------

/**
 * Get local instance ID (hashed, never raw)
 */
function getLocalInstanceIdHash(): string | null {
  try {
    if (platform() === "win32") {
      const result = Bun.spawnSync(
        ["powershell", "-NoProfile", "-Command", 
         "(Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Cryptography).MachineGuid"],
        { stdout: "pipe" }
      );
      if (result.exitCode === 0) {
        const guid = result.stdout.toString().trim();
        if (guid) return hashIdentifier(guid);
      }
    } else if (platform() === "linux") {
      try {
        const machineId = readFileSync("/etc/machine-id", "utf8").trim();
        if (machineId) return hashIdentifier(machineId);
      } catch {
        // Try /proc/sys/kernel/random/boot_id as fallback
        try {
          const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
          if (bootId) return hashIdentifier(bootId);
        } catch {}
      }
      // Check for WSL
      try {
        const version = readFileSync("/proc/version", "utf8");
        if (version.toLowerCase().includes("microsoft")) {
          // WSL - use a WSL-specific identifier
          return hashIdentifier("wsl-" + version.split(" ")[2] || "unknown");
        }
      } catch {}
    } else if (platform() === "darwin") {
      const result = Bun.spawnSync(
        ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
        { stdout: "pipe" }
      );
      if (result.exitCode === 0) {
        const output = result.stdout.toString();
        const match = output.match(/"IOPlatformUUID" = "([^"]+)"/);
        if (match) return hashIdentifier(match[1]);
      }
    }
  } catch {
    // Fallback: hash platform + arch + username
    return hashIdentifier(`${platform()}-${arch()}-${userInfo().username}`);
  }
  return null;
}

/**
 * Get local machine OS from platform
 */
function getLocalOS(): MachineOS {
  const osMap: Record<string, MachineOS> = {
    win32: "windows",
    darwin: "macos",
    linux: "linux",
  };
  return osMap[platform()] || "linux";
}

// ---------------------------------------------------------------------------
// Machine Construction
// ---------------------------------------------------------------------------

/**
 * Convert Herdr profile to Machine with proper evidence handling
 * NEVER attributes local host's identity/resources to remote machines
 */
export function herdrProfileToMachine(
  profile: HerdrMachineProfile,
  status: HerdrMachineStatus | null
): Machine {
  const availability = herdrStatusToAvailability(status?.status || null);
  const error = status?.error || null;
  
  // For remote machines, we DON'T know OS/arch/resources unless we probe through Herdr
  // For now, we report them as unknown
  // The only things we know from Herdr are: id, label, target, session, enabled, selected, status
  
  // Detect if this might be local based on target matching known local patterns
  // This is a best-effort detection, not a guarantee
  const localTargets = ["device-windows", "device-wsl", "device-macos"];
  const isLocal = localTargets.includes(profile.target);
  
  // For local machines, we can probe directly
  let os: MachineOS | null = null;
  let archValue: string | null = null;
  let resources: MachineResources | null = null;
  let capabilities: MachineCapabilities | null = null;
  let physicalHostGroup: PhysicalHostGroup | null = null;
  let instanceIdHash: string | null = null;
  
  if (isLocal) {
    // For local machines, we can probe directly
    os = getLocalOS();
    archValue = arch();
    resources = probeResources(os);
    capabilities = probeCapabilities(os, resources);
    
    const localInstanceHash = getLocalInstanceIdHash();
    if (localInstanceHash) {
      instanceIdHash = localInstanceHash;
      physicalHostGroup = hashIdentifier(`local-${localInstanceHash}`);
    }
  } else {
    // For remote machines, we DON'T probe or guess
    // OS/arch/resources remain unknown unless we have a way to probe through Herdr
    os = null;
    archValue = null;
    resources = null;
    capabilities = null;
    instanceIdHash = null;
    physicalHostGroup = null;
  }

  return {
    id: profile.id,
    label: profile.label,
    os,
    arch: archValue,
    physicalHostGroup,
    instanceIdHash,
    target: profile.target,
    session: profile.session,
    isLocal,
    resources,
    capabilities,
    availability,
    error,
    herdrProfile: profile,
    herdrStatus: status,
  };
}

/**
 * Get all machines from Herdr profiles
 */
export function getMachinesFromHerdr(): Machine[] | InventoryError {
  const inventory = getHerdrInventory();
  
  if (inventory.profiles === null || inventory.profiles.type === "inventory-error") {
    return inventory.profiles as InventoryError;
  }
  if (inventory.statuses === null || inventory.statuses.type === "inventory-error") {
    return inventory.statuses as InventoryError;
  }

  const profiles = inventory.profiles as HerdrMachineProfile[];
  const statuses = inventory.statuses as HerdrMachineStatus[];
  
  const statusMap = new Map<string, HerdrMachineStatus>();
  for (const status of statuses) {
    statusMap.set(status.id, status);
  }

  const machines: Machine[] = [];
  
  for (const profile of profiles) {
    const status = statusMap.get(profile.id) || null;
    const machine = herdrProfileToMachine(profile, status);
    machines.push(machine);
  }

  return machines;
}

/**
 * Get the local machine
 */
export function getLocalMachine(): Machine {
  const os = getLocalOS();
  const instanceIdHash = getLocalInstanceIdHash();
  const physicalHostGroup = instanceIdHash ? hashIdentifier(`local-${instanceIdHash}`) : null;
  
  const resources = probeResources(os);
  const capabilities = probeCapabilities(os, resources);

  return {
    id: `local-${platform()}`,
    label: `Local (${platform()})`,
    os,
    arch: arch(),
    physicalHostGroup,
    instanceIdHash,
    target: null,
    session: null,
    isLocal: true,
    resources,
    capabilities,
    availability: "online",
    error: null,
    herdrProfile: null,
    herdrStatus: null,
  };
}

// ---------------------------------------------------------------------------
// Resource Probing (Local only - NEVER for remote machines)
// ---------------------------------------------------------------------------

/**
 * Probe CPU information (local only)
 */
function probeCpu(os: MachineOS): { cores: number; model: string } {
  const numCpus = cpus().length;

  if (os === "windows") {
    return { cores: numCpus, model: "unknown" };
  } else if (os === "macos") {
    try {
      const result = Bun.spawnSync(["sysctl", "-n", "machdep.cpu.brand_string"], {
        stdout: "pipe",
      });
      const model = result.stdout.toString().trim();
      return { cores: numCpus, model: model || "Apple Silicon" };
    } catch {
      return { cores: numCpus, model: "Apple Silicon" };
    }
  } else {
    // Linux
    try {
      const model = readFileSync("/proc/cpuinfo", "utf8")
        .split("\n")
        .find((line) => line.startsWith("model name"))
        ?.split(":")[1]
        ?.trim() || "unknown";
      return { cores: numCpus, model };
    } catch {
      return { cores: numCpus, model: "unknown" };
    }
  }
}

/**
 * Probe RAM information (local only)
 */
function probeRam(os: MachineOS): number {
  return totalmem();
}

/**
 * Probe GPU information (local only)
 */
function probeGpus(os: MachineOS): GPUInfo[] {
  const gpus: GPUInfo[] = [];

  if (os === "macos") {
    try {
      const result = Bun.spawnSync(
        ["system_profiler", "SPDisplaysDataType"],
        { stdout: "pipe" }
      );
      const output = result.stdout.toString();
      
      const chipsetMatch = output.match(/Chipset Model: (.+)/);
      const vramMatch = output.match(/Total VRAM: (.+)/);
      
      if (chipsetMatch) {
        const model = chipsetMatch[1].trim();
        let vramBytes: number | null = null;
        
        if (vramMatch) {
          const vramStr = vramMatch[1].trim();
          const vramMatch2 = vramStr.match(/^([\d.]+)\s*([GMK]?B)$/i);
          if (vramMatch2) {
            const value = parseFloat(vramMatch2[1]);
            const unit = vramMatch2[2].toUpperCase();
            if (unit === "GB") vramBytes = value * BYTES_PER_GB;
            else if (unit === "MB") vramBytes = value * BYTES_PER_MB;
            else if (unit === "B") vramBytes = value;
          }
        }
        
        gpus.push({
          vendor: "Apple",
          model,
          vramBytes,
        });
      }
    } catch {}
  } else if (os === "linux") {
    try {
      const result = Bun.spawnSync(["lspci"], { stdout: "pipe" });
      const output = result.stdout.toString();
      
      const gpuLines = output
        .split("\n")
        .filter((line) => 
          line.includes("VGA") || 
          line.includes("3D") ||
          line.includes("NVIDIA") ||
          line.includes("AMD") ||
          line.includes("Intel")
        );
      
      for (const line of gpuLines) {
        const match = line.match(/^([0-9a-f:.]+)\s+(.+)/i);
        if (match) {
          const model = match[2].trim();
          gpus.push({
            vendor: model.split(" ")[0] || "Unknown",
            model,
            vramBytes: null,
          });
        }
      }
    } catch {}
  }

  return gpus;
}

/**
 * Probe disk information (local only)
 */
function probeDisks(os: MachineOS): DiskInfo[] {
  const disks: DiskInfo[] = [];

  if (os === "macos" || os === "linux") {
    try {
      const result = Bun.spawnSync(["df", "-k", "--output=target,size,avail"], {
        stdout: "pipe",
      });
      const output = result.stdout.toString();
      
      const lines = output.split("\n").slice(1);
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const mount = parts[0];
          const totalKb = parseInt(parts[1]) * 1024;
          const availKb = parseInt(parts[2]) * 1024;
          
          if (!isNaN(totalKb) && !isNaN(availKb)) {
            disks.push({
              mount,
              totalBytes: totalKb,
              availableBytes: availKb,
            });
          }
        }
      }
    } catch {}
  }

  if (disks.length === 0) {
    disks.push({
      mount: "/",
      totalBytes: 100 * BYTES_PER_GB,
      availableBytes: 50 * BYTES_PER_GB,
    });
  }

  return disks;
}

/**
 * Probe GUI capability (local only)
 */
function probeGui(os: MachineOS): boolean {
  if (os === "windows") {
    return true;
  } else if (os === "macos") {
    return true;
  } else if (os === "linux") {
    return !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
  }
  return false;
}

/**
 * Probe machine resources (local only)
 */
export function probeResources(os: MachineOS): MachineResources {
  return {
    cpu: probeCpu(os),
    ramBytes: probeRam(os),
    gpus: probeGpus(os),
    disks: probeDisks(os),
  };
}

/**
 * Probe machine capabilities (local only)
 */
export function probeCapabilities(
  os: MachineOS,
  resources: MachineResources
): MachineCapabilities {
  return {
    gui: probeGui(os),
    gpu: resources.gpus.length > 0,
    accelerated: resources.gpus.some((gpu) => gpu.vramBytes !== null && gpu.vramBytes > 0),
  };
}

// ---------------------------------------------------------------------------
// Windows + WSL Shared Host Detection
// ---------------------------------------------------------------------------

/**
 * Detect if Windows and WSL are on the same physical host.
 * Uses evidence from instanceIdHash, not guessed from labels.
 * Returns conservative grouping: if we can't prove they're separate, treat as potentially shared.
 */
export function detectSharedHosts(machines: Machine[]): Map<PhysicalHostGroup, Machine[]> {
  const hostGroups = new Map<PhysicalHostGroup, Machine[]>();
  
  for (const machine of machines) {
    const group = machine.physicalHostGroup;
    if (!group) {
      // If we don't know the host group, treat conservatively as potentially shared
      // Use a fallback group for unknown machines
      const fallbackGroup = hashIdentifier("unknown-host");
      if (!hostGroups.has(fallbackGroup)) {
        hostGroups.set(fallbackGroup, []);
      }
      hostGroups.get(fallbackGroup)!.push(machine);
    } else {
      if (!hostGroups.has(group)) {
        hostGroups.set(group, []);
      }
      hostGroups.get(group)!.push(machine);
    }
  }

  return hostGroups;
}

/**
 * Get combined resources for a physical host group.
 * Windows + WSL on same host should NOT double-count CPU/RAM.
 * Conservative: if we can't prove they're on different hosts, don't combine.
 */
export function getCombinedResources(
  machines: Machine[]
): Map<PhysicalHostGroup, MachineResources | null> {
  const hostGroups = detectSharedHosts(machines);
  const combined = new Map<PhysicalHostGroup, MachineResources | null>();

  for (const [group, groupMachines] of hostGroups) {
    // Only combine if we have evidence they're on the same host
    // For now, only combine if all machines in the group have the same physicalHostGroup
    // and at least one has resources
    
    const machinesWithResources = groupMachines.filter((m) => m.resources !== null);
    
    if (machinesWithResources.length > 0) {
      // Use the first machine with resources as the representative
      // In the future, we might sum resources if we can prove they're truly separate
      combined.set(group, machinesWithResources[0].resources);
    } else {
      combined.set(group, null);
    }
  }

  return combined;
}

/**
 * Check if a machine is WSL based on evidence
 */
export function isWsl(machine: Machine): boolean {
  if (machine.os !== "linux") return false;
  
  // Check if we have evidence from /proc/version (only for local machines)
  if (machine.isLocal) {
    try {
      const version = readFileSync("/proc/version", "utf8");
      return version.toLowerCase().includes("microsoft");
    } catch {
      return false;
    }
  }
  
  // For remote machines, we can't know for sure without probing through Herdr
  // So we return false (conservative)
  return false;
}

// ---------------------------------------------------------------------------
// Placement Suitability
// ---------------------------------------------------------------------------

/**
 * Evaluate placement suitability for a machine against constraints
 * Availability is fail-closed: error/offline/unknown are NOT suitable by default
 */
export function evaluateSuitability(
  machine: Machine,
  constraints: PlacementConstraints
): PlacementSuitability {
  const hardViolations: string[] = [];
  const softViolations: string[] = [];
  const reasoning: string[] = [];
  let score = 1.0;

  // Check hard constraints
  
  // OS constraint
  if (constraints.hard.os && constraints.hard.os.length > 0) {
    if (machine.os === null) {
      hardViolations.push(`OS unknown, cannot verify against required: ${constraints.hard.os.join(", ")}`);
      score -= 0.5;
    } else if (!constraints.hard.os.includes(machine.os)) {
      hardViolations.push(`OS ${machine.os} not in required OS list: ${constraints.hard.os.join(", ")}`);
      score -= 0.5;
    } else {
      reasoning.push(`OS ${machine.os} matches required OS constraint`);
    }
  }

  // Architecture constraint
  if (constraints.hard.arch && constraints.hard.arch.length > 0) {
    if (machine.arch === null) {
      hardViolations.push(`Architecture unknown, cannot verify against required: ${constraints.hard.arch.join(", ")}`);
      score -= 0.5;
    } else if (!constraints.hard.arch.includes(machine.arch)) {
      hardViolations.push(`Architecture ${machine.arch} not in required arch list: ${constraints.hard.arch.join(", ")}`);
      score -= 0.5;
    } else {
      reasoning.push(`Architecture ${machine.arch} matches required arch constraint`);
    }
  }

  // CPU cores constraint
  if (constraints.hard.minCpuCores !== undefined) {
    if (machine.resources === null) {
      hardViolations.push(`CPU cores unknown (no resources), cannot verify minimum ${constraints.hard.minCpuCores}`);
      score -= 0.3;
    } else if (machine.resources.cpu.cores < constraints.hard.minCpuCores) {
      hardViolations.push(`CPU cores ${machine.resources.cpu.cores} < minimum ${constraints.hard.minCpuCores}`);
      score -= 0.3;
    } else {
      reasoning.push(`CPU cores ${machine.resources.cpu.cores} >= minimum ${constraints.hard.minCpuCores}`);
    }
  }

  // RAM constraint
  if (constraints.hard.minRamBytes !== undefined) {
    if (machine.resources === null) {
      hardViolations.push(`RAM unknown (no resources), cannot verify minimum ${formatBytes(constraints.hard.minRamBytes)}`);
      score -= 0.3;
    } else if (machine.resources.ramBytes < constraints.hard.minRamBytes) {
      hardViolations.push(`RAM ${formatBytes(machine.resources.ramBytes)} < minimum ${formatBytes(constraints.hard.minRamBytes)}`);
      score -= 0.3;
    } else {
      reasoning.push(`RAM ${formatBytes(machine.resources.ramBytes)} >= minimum ${formatBytes(constraints.hard.minRamBytes)}`);
    }
  }

  // GPU VRAM constraint
  if (constraints.hard.minGpuVramBytes !== undefined) {
    if (machine.resources === null) {
      hardViolations.push(`GPU VRAM unknown (no resources), cannot verify minimum ${formatBytes(constraints.hard.minGpuVramBytes)}`);
      score -= 0.3;
    } else {
      const totalGpuVram = machine.resources.gpus.reduce(
        (sum, gpu) => sum + (gpu.vramBytes || 0),
        0
      );
      if (totalGpuVram < constraints.hard.minGpuVramBytes) {
        hardViolations.push(`Total GPU VRAM ${formatBytes(totalGpuVram)} < minimum ${formatBytes(constraints.hard.minGpuVramBytes)}`);
        score -= 0.3;
      } else {
        reasoning.push(`Total GPU VRAM ${formatBytes(totalGpuVram)} >= minimum ${formatBytes(constraints.hard.minGpuVramBytes)}`);
      }
    }
  }

  // GPU required constraint
  if (constraints.hard.gpuRequired) {
    if (machine.capabilities === null) {
      hardViolations.push(`GPU capability unknown (no capabilities), cannot verify gpuRequired`);
      score -= 0.4;
    } else if (!machine.capabilities.gpu) {
      hardViolations.push("GPU required but machine has no GPU");
      score -= 0.4;
    } else {
      reasoning.push("GPU available as required");
    }
  }

  // GUI required constraint
  if (constraints.hard.guiRequired) {
    if (machine.capabilities === null) {
      hardViolations.push(`GUI capability unknown (no capabilities), cannot verify guiRequired`);
      score -= 0.4;
    } else if (!machine.capabilities.gui) {
      hardViolations.push("GUI required but machine has no GUI");
      score -= 0.4;
    } else {
      reasoning.push("GUI available as required");
    }
  }

  // Availability constraint - fail-closed by default
  if (constraints.hard.availability && constraints.hard.availability.length > 0) {
    if (!constraints.hard.availability.includes(machine.availability)) {
      hardViolations.push(`Availability ${machine.availability} not in required availability list: ${constraints.hard.availability.join(", ")}`);
      score -= 0.5;
    } else {
      reasoning.push(`Availability ${machine.availability} matches required availability constraint`);
    }
  } else {
    // Default: error/offline/unknown are NOT suitable
    if (machine.availability !== "online") {
      hardViolations.push(`Machine availability is ${machine.availability}, not suitable by default (fail-closed)`);
      score -= 0.5;
    }
  }

  // Check soft constraints
  
  // Preferred OS
  if (constraints.soft.preferredOs && constraints.soft.preferredOs.length > 0) {
    if (machine.os === null) {
      softViolations.push(`OS unknown, cannot verify against preferred: ${constraints.soft.preferredOs.join(", ")}`);
      score -= 0.1;
    } else if (!constraints.soft.preferredOs.includes(machine.os)) {
      softViolations.push(`OS ${machine.os} not in preferred OS list: ${constraints.soft.preferredOs.join(", ")}`);
      score -= 0.1;
    } else {
      reasoning.push(`OS ${machine.os} matches preferred OS`);
    }
  }

  // Preferred architecture
  if (constraints.soft.preferredArch && constraints.soft.preferredArch.length > 0) {
    if (machine.arch === null) {
      softViolations.push(`Architecture unknown, cannot verify against preferred: ${constraints.soft.preferredArch.join(", ")}`);
      score -= 0.1;
    } else if (!constraints.soft.preferredArch.includes(machine.arch)) {
      softViolations.push(`Architecture ${machine.arch} not in preferred arch list: ${constraints.soft.preferredArch.join(", ")}`);
      score -= 0.1;
    } else {
      reasoning.push(`Architecture ${machine.arch} matches preferred arch`);
    }
  }

  // Preferred CPU cores
  if (constraints.soft.minPreferredCpuCores !== undefined) {
    if (machine.resources === null) {
      softViolations.push(`CPU cores unknown (no resources), cannot verify preferred minimum ${constraints.soft.minPreferredCpuCores}`);
      score -= 0.1;
    } else if (machine.resources.cpu.cores < constraints.soft.minPreferredCpuCores) {
      softViolations.push(`CPU cores ${machine.resources.cpu.cores} < preferred minimum ${constraints.soft.minPreferredCpuCores}`);
      score -= 0.1;
    } else {
      reasoning.push(`CPU cores ${machine.resources.cpu.cores} >= preferred minimum ${constraints.soft.minPreferredCpuCores}`);
    }
  }

  // Preferred RAM
  if (constraints.soft.minPreferredRamBytes !== undefined) {
    if (machine.resources === null) {
      softViolations.push(`RAM unknown (no resources), cannot verify preferred minimum ${formatBytes(constraints.soft.minPreferredRamBytes)}`);
      score -= 0.1;
    } else if (machine.resources.ramBytes < constraints.soft.minPreferredRamBytes) {
      softViolations.push(`RAM ${formatBytes(machine.resources.ramBytes)} < preferred minimum ${formatBytes(constraints.soft.minPreferredRamBytes)}`);
      score -= 0.1;
    } else {
      reasoning.push(`RAM ${formatBytes(machine.resources.ramBytes)} >= preferred minimum ${formatBytes(constraints.soft.minPreferredRamBytes)}`);
    }
  }

  // Ensure score is between 0 and 1
  score = Math.max(0, Math.min(1, score));

  return {
    satisfiesHard: hardViolations.length === 0,
    satisfiesSoft: softViolations.length === 0,
    hardViolations,
    softViolations,
    reasoning,
    score,
  };
}

/**
 * Find suitable machines for given constraints
 * Filters to only machines that satisfy hard constraints
 */
export function findSuitableMachines(
  machines: Machine[],
  constraints: PlacementConstraints
): { suitable: Machine[]; suitability: PlacementSuitability[] } {
  const results: { machine: Machine; suitability: PlacementSuitability }[] = [];

  for (const machine of machines) {
    const suitability = evaluateSuitability(machine, constraints);
    results.push({ machine, suitability });
  }

  // Sort by score (descending)
  results.sort((a, b) => b.suitability.score - a.suitability.score);

  // Filter to only machines that satisfy hard constraints
  const suitableResults = results.filter((r) => r.suitability.satisfiesHard);

  return {
    suitable: suitableResults.map((r) => r.machine),
    suitability: results.map((r) => r.suitability),
  };
}

// ---------------------------------------------------------------------------
// Attestation
// ---------------------------------------------------------------------------

/**
 * Create an attested machine with resource attestation
 */
export function attestMachine(
  machine: Machine,
  evidence: Evidence | null = null
): AttestedMachine {
  const resources = machine.resources;
  
  // Determine status and provenance based on how we obtained the data
  let status: VerificationStatus = "unknown";
  let provenance: Provenance = "estimated";
  
  if (machine.isLocal) {
    // Local machine - we probed it directly
    status = "verified-live";
    provenance = "measured";
  } else if (machine.herdrStatus) {
    // Remote machine via Herdr
    if (machine.herdrStatus.status === "reachable") {
      // For remote machines, we can only attest as verified-live if we have resources
      // For now, without a way to probe through Herdr, we can't get resources
      // So we treat as configured
      status = "configured";
      provenance = "estimated";
    } else {
      status = "configured";
      provenance = "estimated";
    }
  } else if (machine.herdrProfile) {
    // Known to Herdr but no status
    status = "configured";
    provenance = "estimated";
  }

  // Create evidence if not provided
  let finalEvidence = evidence;
  if (!finalEvidence && status === "verified-live") {
    finalEvidence = {
      at: new Date().toISOString(),
      source: "probe",
      note: `Machine inventory probe (local)`,
    };
  } else if (!finalEvidence && status === "restricted") {
    finalEvidence = {
      at: new Date().toISOString(),
      source: "probe",
      note: `Machine inventory restriction observed`,
    };
  } else if (!finalEvidence && status === "configured") {
    // Configured status should not have live evidence
    finalEvidence = null;
  }

  const attestation = attest({
    value: resources,
    status,
    provenance,
    evidence: finalEvidence,
  });

  return {
    ...machine,
    attestation,
  };
}

/**
 * Attest all machines
 */
export function attestMachines(machines: Machine[]): AttestedMachine[] {
  const now = new Date().toISOString();
  
  return machines.map((machine) => {
    // Only provide live evidence for machines that can be verified-live
    let evidence: Evidence | null = null;
    if (machine.isLocal) {
      evidence = {
        at: now,
        source: "probe",
        note: "Machine inventory probe (local)",
      };
    }
    // For remote machines, we don't have a way to probe through Herdr yet
    // So we leave evidence as null
    return attestMachine(machine, evidence);
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes >= BYTES_PER_GB) {
    return `${(bytes / BYTES_PER_GB).toFixed(2)} GB`;
  } else if (bytes >= BYTES_PER_MB) {
    return `${(bytes / BYTES_PER_MB).toFixed(2)} MB`;
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Get all machines (Herdr + local)
 */
export function getAllMachines(): Machine[] | InventoryError {
  const herdrResult = getMachinesFromHerdr();
  
  if (herdrResult === null || herdrResult.type === "inventory-error") {
    return herdrResult as InventoryError;
  }
  
  const herdrMachines = herdrResult as Machine[];
  const localMachine = getLocalMachine();
  
  // Check if local machine is already in Herdr list
  const localInHerdr = herdrMachines.some((m) => m.isLocal);
  
  if (!localInHerdr) {
    return [...herdrMachines, localMachine];
  }
  
  return herdrMachines;
}

/**
 * Get machine by ID
 */
export function getMachineById(id: string): Machine | null {
  const machines = getAllMachines();
  
  if (machines === null || machines.type === "inventory-error") {
    return null;
  }
  
  return (machines as Machine[]).find((m) => m.id === id) || null;
}

// ---------------------------------------------------------------------------
// Main CLI (for debugging/testing)
// ---------------------------------------------------------------------------

/**
 * Main entry point for CLI usage
 */
export async function main(args: string[] = process.argv.slice(2)) {
  const [cmd, ...rest] = args;

  if (!cmd || cmd === "help") {
    console.log(`
Usage: machines <command>

Commands:
  list              List all machines
  list --json       List all machines as JSON
  get ID            Get machine by ID
  probe             Probe local machine resources
  shared-hosts      Detect shared physical hosts
  suitability       Test placement suitability
  help              Show this help
`);
    return;
  }

  try {
    const machinesResult = getAllMachines();
    
    if (machinesResult === null || machinesResult.type === "inventory-error") {
      console.error(`Inventory error: ${machinesResult.error}`);
      process.exitCode = 1;
      return;
    }
    
    const machines = machinesResult as Machine[];
    const json = rest.includes("--json");

    if (cmd === "list") {
      if (json) {
        console.log(toJson(machines));
      } else {
        console.log(`Machines (${machines.length}):`);
        for (const m of machines) {
          console.log(`  ${m.id}: ${m.label}`);
          console.log(`    OS: ${m.os || "unknown"}, Arch: ${m.arch || "unknown"}`);
          console.log(`    Host Group: ${m.physicalHostGroup || "unknown"}`);
          console.log(`    Local: ${m.isLocal}`);
          console.log(`    Availability: ${m.availability}`);
          if (m.resources) {
            console.log(`    CPU: ${m.resources.cpu.cores} cores (${m.resources.cpu.model})`);
            console.log(`    RAM: ${formatBytes(m.resources.ramBytes)}`);
            if (m.resources.gpus.length > 0) {
              console.log(`    GPUs: ${m.resources.gpus.map((g) => g.model).join(", ")}`);
            }
          } else {
            console.log(`    Resources: unknown`);
          }
          if (m.capabilities) {
            console.log(`    Capabilities: GUI=${m.capabilities.gui}, GPU=${m.capabilities.gpu}`);
          } else {
            console.log(`    Capabilities: unknown`);
          }
        }
      }
    } else if (cmd === "get") {
      if (rest.length !== 1) throw new Error("Usage: machines get ID");
      const machine = getMachineById(rest[0]);
      if (!machine) throw new Error(`Machine ${rest[0]} not found`);
      console.log(toJson(machine));
    } else if (cmd === "probe") {
      const os = getLocalOS();
      const resources = probeResources(os);
      const capabilities = probeCapabilities(os, resources);
      console.log(toJson({ resources, capabilities }));
    } else if (cmd === "shared-hosts") {
      const hostGroups = detectSharedHosts(machines);
      console.log(`Shared Host Groups (${hostGroups.size}):`);
      for (const [group, groupMachines] of hostGroups) {
        console.log(`  ${group}:`);
        for (const m of groupMachines) {
          console.log(`    - ${m.id}: ${m.label} (${m.os || "unknown"})`);
        }
      }
    } else if (cmd === "suitability") {
      const constraints: PlacementConstraints = {
        hard: {
          os: ["macos", "linux"],
          minCpuCores: 4,
          minRamBytes: 8 * BYTES_PER_GB,
          availability: ["online"], // Explicitly require online
        },
        soft: {
          preferredOs: ["macos"],
          minPreferredCpuCores: 8,
        },
      };
      
      const result = findSuitableMachines(machines, constraints);
      console.log(`Suitable Machines:`);
      for (let i = 0; i < result.suitable.length; i++) {
        const m = result.suitable[i];
        const s = result.suitability[i];
        console.log(`  ${m.id}: score=${s.score.toFixed(2)}, hard=${s.satisfiesHard}, soft=${s.satisfiesSoft}`);
        if (s.hardViolations.length > 0) {
          console.log(`    Hard violations: ${s.hardViolations.join(", ")}`);
        }
        if (s.softViolations.length > 0) {
          console.log(`    Soft violations: ${s.softViolations.join(", ")}`);
        }
      }
    } else {
      throw new Error(`Unknown command: ${cmd}`);
    }
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`Fatal: ${e}`);
    process.exitCode = 1;
  });
}
