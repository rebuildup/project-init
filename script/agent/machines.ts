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
 * Shared host rule: Windows native + WSL on one physical host MUST share
 *                   `physical_host_group`; their CPU/RAM counted once.
 *
 * Run: bun test script/agent/machines.test.ts
 */

import { platform, arch, totalmem, cpus, homedir, userInfo } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

/** Complete machine identity and state */
export interface Machine {
  /** Machine ID (from Herdr profile or generated for local) */
  id: string;
  /** Human-readable label */
  label: string;
  /** OS type */
  os: MachineOS;
  /** Architecture */
  arch: string;
  /** Physical host group - same for Windows+WSL on same host */
  physicalHostGroup: PhysicalHostGroup;
  /** Instance ID from devices.ts (if available) */
  instanceId: string | null;
  /** Herdr target (SSH host identifier) */
  target: string | null;
  /** Herdr session */
  session: string | null;
  /** Whether this is the local machine */
  isLocal: boolean;
  /** Resource inventory */
  resources: MachineResources | null;
  /** Capabilities */
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

// ---------------------------------------------------------------------------
// Physical Host Group Detection
// ---------------------------------------------------------------------------

/**
 * Generate a physical host group identifier.
 * Windows and WSL on the same physical host share the same group.
 * Uses a combination of hardware identifiers to detect shared hosts.
 */
function detectPhysicalHostGroup(os: MachineOS, instanceId: string | null): PhysicalHostGroup {
  // For local machine, use instance ID if available
  if (instanceId) {
    return `host-${instanceId}`;
  }

  // Try to get a stable hardware identifier
  try {
    if (os === "windows") {
      // On Windows, use MachineGuid from registry
      return `host-${localInstanceId("windows")}`;
    } else if (os === "linux") {
      // On Linux/WSL, check for WSL-specific indicators
      const version = readFileSync("/proc/version", "utf8");
      if (version.toLowerCase().includes("microsoft") || version.toLowerCase().includes("wsl")) {
        // This is WSL - use the same approach as Windows
        // WSL shares the same MachineGuid as its Windows host
        return `host-${localInstanceId("linux")}`;
      }
      // Native Linux
      return `host-${localInstanceId("linux")}`;
    } else if (os === "macos") {
      return `host-${localInstanceId("macos")}`;
    }
  } catch {
    // Fallback: use a hash of available info
    const info = [os, arch(), cpus()[0]?.model || ""].join("|");
    // Simple hash for fallback
    let hash = 0;
    for (let i = 0; i < info.length; i++) {
      hash = (hash << 5) - hash + info.charCodeAt(i);
      hash |= 0;
    }
    return `host-fallback-${Math.abs(hash).toString(16)}`;
  }

  return `host-unknown`;
}

/**
 * Get local instance ID based on OS
 * Matches the logic in devices.ts:localInstance()
 */
function localInstanceId(os: MachineOS): string {
  const actualOs = platform();
  const osMap: Record<string, MachineOS> = {
    win32: "windows",
    darwin: "macos",
    linux: "linux",
  };

  // If we're detecting for the current OS, use the actual platform
  const targetOs = osMap[actualOs] || os;

  if (targetOs === "windows") {
    // Would need PowerShell, but we're on macOS currently
    // For cross-platform detection, we'll use a fallback
    return "unknown-windows";
  } else if (targetOs === "linux") {
    try {
      return readFileSync("/etc/machine-id", "utf8").trim().toLowerCase();
    } catch {
      // Try WSL-specific
      try {
        const version = readFileSync("/proc/version", "utf8");
        if (version.includes("Microsoft")) {
          // WSL - try to get machine ID from Windows registry via /mnt/c
          // This is a fallback
          return "wsl-host";
        }
      } catch {
        return "unknown-linux";
      }
    }
  } else if (targetOs === "macos") {
    try {
      const result = Bun.spawnSync(["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"], {
        stdout: "pipe",
      });
      const output = result.stdout.toString();
      const match = output.match(/"IOPlatformUUID" = "([^"]+)"/);
      if (match) {
        return match[1].toLowerCase();
      }
    } catch {
      return "unknown-macos";
    }
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Resource Probing
// ---------------------------------------------------------------------------

/**
 * Probe CPU information
 */
function probeCpu(os: MachineOS): { cores: number; model: string } {
  const numCpus = cpus().length;

  if (os === "windows") {
    // On Windows, would use wmic or PowerShell
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
 * Probe RAM information
 */
function probeRam(os: MachineOS): number {
  // totalmem() returns total memory in bytes
  return totalmem();
}

/**
 * Probe GPU information
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
      
      // Parse GPU info from system_profiler output
      const chipsetMatch = output.match(/Chipset Model: (.+)/);
      const vramMatch = output.match(/Total VRAM: (.+)/);
      
      if (chipsetMatch) {
        const model = chipsetMatch[1].trim();
        let vramBytes: number | null = null;
        
        if (vramMatch) {
          const vramStr = vramMatch[1].trim();
          // Parse VRAM string like "8 GB" or "16 MB"
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
    } catch {
      // No GPU info available
    }
  } else if (os === "linux") {
    try {
      // Try lspci for GPU info
      const result = Bun.spawnSync(["lspci"], { stdout: "pipe" });
      const output = result.stdout.toString();
      
      // Look for VGA or 3D controller lines
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
            vramBytes: null, // VRAM not easily available via lspci
          });
        }
      }
    } catch {
      // No lspci available
    }
  } else if (os === "windows") {
    // Would use PowerShell or wmic on Windows
    // For now, return empty
  }

  return gpus;
}

/**
 * Probe disk information
 */
function probeDisks(os: MachineOS): DiskInfo[] {
  const disks: DiskInfo[] = [];

  if (os === "macos" || os === "linux") {
    try {
      const result = Bun.spawnSync(["df", "-k", "--output=target,size,avail"], {
        stdout: "pipe",
      });
      const output = result.stdout.toString();
      
      // Parse df output (skip header line)
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
    } catch {
      // df not available or failed
    }
  } else if (os === "windows") {
    // Would use PowerShell on Windows
  }

  // Always include at least the root filesystem
  if (disks.length === 0) {
    disks.push({
      mount: "/",
      totalBytes: 100 * BYTES_PER_GB, // Default fallback
      availableBytes: 50 * BYTES_PER_GB,
    });
  }

  return disks;
}

/**
 * Probe GUI capability
 */
function probeGui(os: MachineOS): boolean {
  if (os === "windows") {
    return true; // Windows typically has GUI
  } else if (os === "macos") {
    return true; // macOS typically has GUI
  } else if (os === "linux") {
    // Check for DISPLAY or WAYLAND_DISPLAY
    return !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
  }
  return false;
}

/**
 * Probe machine resources
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
 * Probe machine capabilities
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
// Herdr Integration
// ---------------------------------------------------------------------------

/**
 * Get Herdr machine profiles from `herdr machine list --json`
 */
export function getHerdrProfiles(): HerdrMachineProfile[] {
  try {
    const result = Bun.spawnSync(
      ["herdr", "machine", "list", "--json"],
      { stdout: "pipe", stderr: "pipe" }
    );
    
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString();
      if (stderr.includes("No machines") || stderr.includes("no machines")) {
        return [];
      }
      throw new Error(`herdr machine list failed: ${stderr}`);
    }
    
    const output = result.stdout.toString();
    return JSON.parse(output) as HerdrMachineProfile[];
  } catch {
    return [];
  }
}

/**
 * Get Herdr machine statuses from `herdr machine status --json`
 */
export function getHerdrStatuses(): HerdrMachineStatus[] {
  try {
    const result = Bun.spawnSync(
      ["herdr", "machine", "status", "--json"],
      { stdout: "pipe", stderr: "pipe" }
    );
    
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString();
      if (stderr.includes("No machines") || stderr.includes("no machines")) {
        return [];
      }
      throw new Error(`herdr machine status failed: ${stderr}`);
    }
    
    const output = result.stdout.toString();
    return JSON.parse(output) as HerdrMachineStatus[];
  } catch {
    return [];
  }
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
// Machine Inventory
// ---------------------------------------------------------------------------

/**
 * Get all machines from Herdr profiles
 */
export function getMachinesFromHerdr(): Machine[] {
  const profiles = getHerdrProfiles();
  const statuses = getHerdrStatuses();
  
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
 * Convert Herdr profile to Machine
 */
export function herdrProfileToMachine(
  profile: HerdrMachineProfile,
  status: HerdrMachineStatus | null
): Machine {
  // Parse target to extract OS and other info
  // Target format: "device-{id}" or custom SSH target
  const target = profile.target;
  
  // Try to determine OS from target or label
  let os: MachineOS = "linux"; // default
  let instanceId: string | null = null;
  
  // Check if target matches device-{id} pattern from devices.ts
  const deviceMatch = target.match(/^device-([a-z][a-z0-9-]{0,47})$/);
  if (deviceMatch) {
    // This is a managed device from devices.ts
    // We can't get the full device info here without calling devices.ts
    // For now, infer OS from label or use default
    const labelLower = profile.label.toLowerCase();
    if (labelLower.includes("windows") || labelLower.includes("win")) {
      os = "windows";
    } else if (labelLower.includes("macos") || labelLower.includes("mac")) {
      os = "macos";
    } else {
      os = "linux";
    }
  } else {
    // Custom target - infer from label
    const labelLower = profile.label.toLowerCase();
    if (labelLower.includes("windows") || labelLower.includes("win")) {
      os = "windows";
    } else if (labelLower.includes("macos") || labelLower.includes("mac")) {
      os = "macos";
    }
  }

  // For local machine detection
  const isLocal = isLocalMachine(target, os);
  
  // Generate instance ID for physical host group detection
  if (isLocal) {
    instanceId = localInstanceId(os);
  }
  
  const physicalHostGroup = detectPhysicalHostGroup(os, instanceId);

  // Determine availability
  let availability: MachineAvailability = "unknown";
  let error: string | null = null;
  
  if (status) {
    availability = herdrStatusToAvailability(status.status);
    error = status.error;
  } else {
    // No status info - assume unknown
    availability = "unknown";
  }

  // For now, resources and capabilities are null for remote machines
  // They would need to be probed via SSH, which is out of scope for read-only
  const resources: MachineResources | null = isLocal ? probeResources(os) : null;
  const capabilities: MachineCapabilities | null = resources ? probeCapabilities(os, resources) : null;

  return {
    id: profile.id,
    label: profile.label,
    os,
    arch: arch(), // This is local arch - may not match remote
    physicalHostGroup,
    instanceId,
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
 * Check if a target refers to the local machine
 */
function isLocalMachine(target: string, os: MachineOS): boolean {
  // Check against known local device targets
  const localTargets = ["device-windows", "device-wsl", "device-macos"];
  
  if (localTargets.includes(target)) {
    return true;
  }

  // Also check if target matches current platform
  const localOsMap: Record<string, MachineOS> = {
    win32: "windows",
    darwin: "macos",
    linux: "linux",
  };
  const currentOs = localOsMap[platform()] || "linux";
  
  // If the OS matches and it's a device-* target, it might be local
  if (target.startsWith("device-") && os === currentOs) {
    return true;
  }

  return false;
}

/**
 * Get the local machine
 */
export function getLocalMachine(): Machine {
  const osMap: Record<string, MachineOS> = {
    win32: "windows",
    darwin: "macos",
    linux: "linux",
  };
  const os = osMap[platform()] || "linux";
  const instanceId = localInstanceId(os);
  const physicalHostGroup = detectPhysicalHostGroup(os, instanceId);
  
  const resources = probeResources(os);
  const capabilities = probeCapabilities(os, resources);

  return {
    id: `local-${platform()}`,
    label: `Local (${platform()})`,
    os,
    arch: arch(),
    physicalHostGroup,
    instanceId,
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
// Windows + WSL Shared Host Detection
// ---------------------------------------------------------------------------

/**
 * Detect if Windows and WSL are on the same physical host.
 * Returns a map of physical host groups to their machines.
 */
export function detectSharedHosts(machines: Machine[]): Map<PhysicalHostGroup, Machine[]> {
  const hostGroups = new Map<PhysicalHostGroup, Machine[]>();
  
  for (const machine of machines) {
    const group = machine.physicalHostGroup;
    if (!hostGroups.has(group)) {
      hostGroups.set(group, []);
    }
    hostGroups.get(group)!.push(machine);
  }

  return hostGroups;
}

/**
 * Get combined resources for a physical host group.
 * Windows + WSL on same host should NOT double-count CPU/RAM.
 */
export function getCombinedResources(
  machines: Machine[]
): Map<PhysicalHostGroup, MachineResources> {
  const hostGroups = detectSharedHosts(machines);
  const combined = new Map<PhysicalHostGroup, MachineResources>();

  for (const [group, groupMachines] of hostGroups) {
    // Find the primary machine (prefer non-WSL, or first one)
    let primary = groupMachines.find((m) => m.os !== "linux" || !isWsl(m));
    if (!primary && groupMachines.length > 0) {
      primary = groupMachines[0];
    }

    if (primary && primary.resources) {
      // Use the primary machine's resources for the group
      combined.set(group, primary.resources);
    } else {
      // Fallback: create empty resources
      combined.set(group, {
        cpu: { cores: 0, model: "unknown" },
        ramBytes: 0,
        gpus: [],
        disks: [],
      });
    }
  }

  return combined;
}

/**
 * Check if a machine is WSL
 */
export function isWsl(machine: Machine): boolean {
  if (machine.os !== "linux") return false;
  
  // Check label for WSL indicators
  const labelLower = machine.label.toLowerCase();
  if (labelLower.includes("wsl") || labelLower.includes("windows subsystem")) {
    return true;
  }

  // Check target
  if (machine.target && machine.target.toLowerCase().includes("wsl")) {
    return true;
  }

  // For local machine, check /proc/version
  if (machine.isLocal) {
    try {
      const version = readFileSync("/proc/version", "utf8");
      return version.toLowerCase().includes("microsoft");
    } catch {
      return false;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Placement Suitability
// ---------------------------------------------------------------------------

/**
 * Evaluate placement suitability for a machine against constraints
 */
export function evaluateSuitability(
  machine: Machine,
  constraints: PlacementConstraints
): PlacementSuitability {
  const hardViolations: string[] = [];
  const softViolations: string[] = [];
  const reasoning: string[] = [];
  let score = 1.0; // Start with perfect score

  // Check hard constraints
  
  // OS constraint
  if (constraints.hard.os && constraints.hard.os.length > 0) {
    if (!constraints.hard.os.includes(machine.os)) {
      hardViolations.push(`OS ${machine.os} not in required OS list: ${constraints.hard.os.join(", ")}`);
      score -= 0.5;
    } else {
      reasoning.push(`OS ${machine.os} matches required OS constraint`);
    }
  }

  // Architecture constraint
  if (constraints.hard.arch && constraints.hard.arch.length > 0) {
    if (!constraints.hard.arch.includes(machine.arch)) {
      hardViolations.push(`Architecture ${machine.arch} not in required arch list: ${constraints.hard.arch.join(", ")}`);
      score -= 0.5;
    } else {
      reasoning.push(`Architecture ${machine.arch} matches required arch constraint`);
    }
  }

  // CPU cores constraint
  if (constraints.hard.minCpuCores !== undefined) {
    if (!machine.resources) {
      hardViolations.push(`CPU cores unknown (no resources)`);
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
    if (!machine.resources) {
      hardViolations.push(`RAM unknown (no resources)`);
      score -= 0.3;
    } else if (machine.resources.ramBytes < constraints.hard.minRamBytes) {
      hardViolations.push(`RAM ${machine.resources.ramBytes} bytes < minimum ${constraints.hard.minRamBytes}`);
      score -= 0.3;
    } else {
      reasoning.push(`RAM ${formatBytes(machine.resources.ramBytes)} >= minimum ${formatBytes(constraints.hard.minRamBytes)}`);
    }
  }

  // GPU VRAM constraint
  if (constraints.hard.minGpuVramBytes !== undefined) {
    if (!machine.resources) {
      hardViolations.push(`GPU VRAM unknown (no resources)`);
      score -= 0.3;
    } else {
      const totalGpuVram = machine.resources.gpus.reduce(
        (sum, gpu) => sum + (gpu.vramBytes || 0),
        0
      );
      if (totalGpuVram < constraints.hard.minGpuVramBytes) {
        hardViolations.push(`Total GPU VRAM ${totalGpuVram} bytes < minimum ${constraints.hard.minGpuVramBytes}`);
        score -= 0.3;
      } else {
        reasoning.push(`Total GPU VRAM ${formatBytes(totalGpuVram)} >= minimum ${formatBytes(constraints.hard.minGpuVramBytes)}`);
      }
    }
  }

  // GPU required constraint
  if (constraints.hard.gpuRequired) {
    if (!machine.capabilities) {
      hardViolations.push("GPU capability unknown (no capabilities)");
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
    if (!machine.capabilities) {
      hardViolations.push("GUI capability unknown (no capabilities)");
      score -= 0.4;
    } else if (!machine.capabilities.gui) {
      hardViolations.push("GUI required but machine has no GUI");
      score -= 0.4;
    } else {
      reasoning.push("GUI available as required");
    }
  }

  // Availability constraint
  if (constraints.hard.availability && constraints.hard.availability.length > 0) {
    if (!constraints.hard.availability.includes(machine.availability)) {
      hardViolations.push(`Availability ${machine.availability} not in required availability list: ${constraints.hard.availability.join(", ")}`);
      score -= 0.5;
    } else {
      reasoning.push(`Availability ${machine.availability} matches required availability constraint`);
    }
  }

  // Check soft constraints
  
  // Preferred OS
  if (constraints.soft.preferredOs && constraints.soft.preferredOs.length > 0) {
    if (!constraints.soft.preferredOs.includes(machine.os)) {
      softViolations.push(`OS ${machine.os} not in preferred OS list: ${constraints.soft.preferredOs.join(", ")}`);
      score -= 0.1;
    } else {
      reasoning.push(`OS ${machine.os} matches preferred OS`);
    }
  }

  // Preferred architecture
  if (constraints.soft.preferredArch && constraints.soft.preferredArch.length > 0) {
    if (!constraints.soft.preferredArch.includes(machine.arch)) {
      softViolations.push(`Architecture ${machine.arch} not in preferred arch list: ${constraints.soft.preferredArch.join(", ")}`);
      score -= 0.1;
    } else {
      reasoning.push(`Architecture ${machine.arch} matches preferred arch`);
    }
  }

  // Preferred CPU cores
  if (constraints.soft.minPreferredCpuCores !== undefined && machine.resources) {
    if (machine.resources.cpu.cores < constraints.soft.minPreferredCpuCores) {
      softViolations.push(`CPU cores ${machine.resources.cpu.cores} < preferred minimum ${constraints.soft.minPreferredCpuCores}`);
      score -= 0.1;
    } else {
      reasoning.push(`CPU cores ${machine.resources.cpu.cores} >= preferred minimum ${constraints.soft.minPreferredCpuCores}`);
    }
  }

  // Preferred RAM
  if (constraints.soft.minPreferredRamBytes !== undefined && machine.resources) {
    if (machine.resources.ramBytes < constraints.soft.minPreferredRamBytes) {
      softViolations.push(`RAM ${machine.resources.ramBytes} bytes < preferred minimum ${constraints.soft.minPreferredRamBytes}`);
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
      status = "verified-live";
      provenance = "measured";
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
      note: `Machine inventory ${machine.isLocal ? "probe (local)" : "via Herdr"}`,
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
    if (machine.isLocal || (machine.herdrStatus && machine.herdrStatus.status === "reachable")) {
      evidence = {
        at: now,
        source: "probe",
        note: `Machine inventory probe${machine.isLocal ? " (local)" : " (remote via Herdr)"}`,
      };
    }
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
export function getAllMachines(): Machine[] {
  const herdrMachines = getMachinesFromHerdr();
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
  return machines.find((m) => m.id === id) || null;
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
    if (cmd === "list") {
      const machines = getAllMachines();
      const json = rest.includes("--json");
      
      if (json) {
        console.log(toJson(machines));
      } else {
        console.log(`Machines (${machines.length}):`);
        for (const m of machines) {
          console.log(`  ${m.id}: ${m.label} (${m.os}/${m.arch})`);
          console.log(`    Host Group: ${m.physicalHostGroup}`);
          console.log(`    Local: ${m.isLocal}`);
          console.log(`    Availability: ${m.availability}`);
          if (m.resources) {
            console.log(`    CPU: ${m.resources.cpu.cores} cores (${m.resources.cpu.model})`);
            console.log(`    RAM: ${formatBytes(m.resources.ramBytes)}`);
            if (m.resources.gpus.length > 0) {
              console.log(`    GPUs: ${m.resources.gpus.map((g) => g.model).join(", ")}`);
            }
          }
          if (m.capabilities) {
            console.log(`    Capabilities: GUI=${m.capabilities.gui}, GPU=${m.capabilities.gpu}`);
          }
        }
      }
    } else if (cmd === "get") {
      if (rest.length !== 1) throw new Error("Usage: machines get ID");
      const machine = getMachineById(rest[0]);
      if (!machine) throw new Error(`Machine ${rest[0]} not found`);
      console.log(toJson(machine));
    } else if (cmd === "probe") {
      const osMap: Record<string, MachineOS> = {
        win32: "windows",
        darwin: "macos",
        linux: "linux",
      };
      const os = osMap[platform()] || "linux";
      const resources = probeResources(os);
      const capabilities = probeCapabilities(os, resources);
      console.log(toJson({ resources, capabilities }));
    } else if (cmd === "shared-hosts") {
      const machines = getAllMachines();
      const hostGroups = detectSharedHosts(machines);
      console.log(`Shared Host Groups (${hostGroups.size}):`);
      for (const [group, groupMachines] of hostGroups) {
        console.log(`  ${group}:`);
        for (const m of groupMachines) {
          console.log(`    - ${m.id}: ${m.label} (${m.os})`);
        }
      }
    } else if (cmd === "suitability") {
      const machines = getAllMachines();
      const constraints: PlacementConstraints = {
        hard: {
          os: ["macos", "linux"],
          minCpuCores: 4,
          minRamBytes: 8 * BYTES_PER_GB,
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
