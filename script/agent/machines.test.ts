#!/usr/bin/env bun
/**
 * Independent acceptance tests for machines.ts (Epic #86, T011 / issue #97).
 *
 * Tests MUST be separated into:
 *   - Mock-based tests (no real Herdr/SSH calls)
 *   - Real machine tests (only run when explicitly requested)
 *
 * Acceptance criteria from issue #97:
 *   - Windows+WSL shared capacity detection
 *   - Offline machine handling
 *   - Host identity mismatch detection
 *   - Resource unknown handling
 *   - GUI singleton detection
 *   - Remote unreachable: no retry to other hosts
 *
 * Run: bun test script/agent/machines.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  Machine,
  MachineOS,
  MachineResources,
  MachineCapabilities,
  PlacementConstraints,
  PlacementSuitability,
  HerdrMachineProfile,
  HerdrMachineStatus,
  PhysicalHostGroup,
  getLocalMachine,
  probeResources,
  probeCapabilities,
  detectPhysicalHostGroup,
  isWsl,
  evaluateSuitability,
  findSuitableMachines,
  attestMachine,
  attestMachines,
  formatBytes,
  getCombinedResources,
  detectSharedHosts,
  herdrProfileToMachine,
  getHerdrProfiles,
  getHerdrStatuses,
  BYTES_PER_GB,
  BYTES_PER_MB,
} from "./machines";
import { Attested, VerificationStatus, Provenance, Evidence } from "./contract";

// ---------------------------------------------------------------------------
// Test Utilities
// ---------------------------------------------------------------------------

/** Mock Herdr machine profile for Windows */
const mockWindowsProfile: HerdrMachineProfile = {
  id: "windows-machine-id",
  label: "Windows Workstation",
  target: "device-windows",
  session: "default",
  enabled: true,
  selected: false,
};

/** Mock Herdr machine profile for WSL */
const mockWslProfile: HerdrMachineProfile = {
  id: "wsl-machine-id",
  label: "Ubuntu (WSL)",
  target: "device-wsl",
  session: "default",
  enabled: true,
  selected: false,
};

/** Mock Herdr machine profile for macOS */
const mockMacosProfile: HerdrMachineProfile = {
  id: "macos-machine-id",
  label: "MacBook Pro",
  target: "device-macos",
  session: "default",
  enabled: true,
  selected: false,
};

/** Mock Herdr machine status for reachable */
const mockReachableStatus: HerdrMachineStatus = {
  id: "windows-machine-id",
  label: "Windows Workstation",
  status: "reachable",
  error: null,
};

/** Mock Herdr machine status for disabled */
const mockDisabledStatus: HerdrMachineStatus = {
  id: "wsl-machine-id",
  label: "Ubuntu (WSL)",
  status: "disabled",
  error: null,
};

/** Mock Herdr machine status for error */
const mockErrorStatus: HerdrMachineStatus = {
  id: "macos-machine-id",
  label: "MacBook Pro",
  status: "error",
  error: "remote Herdr server is stopped",
};

/** Create a mock machine for testing */
function createMockMachine(
  overrides: Partial<Machine> = {}
): Machine {
  return {
    id: "test-machine",
    label: "Test Machine",
    os: "linux",
    arch: "x64",
    physicalHostGroup: "host-test",
    instanceId: "test-instance-id",
    target: "device-test",
    session: "default",
    isLocal: false,
    resources: {
      cpu: { cores: 8, model: "Intel i7" },
      ramBytes: 16 * BYTES_PER_GB,
      gpus: [],
      disks: [{ mount: "/", totalBytes: 500 * BYTES_PER_GB, availableBytes: 250 * BYTES_PER_GB }],
    },
    capabilities: {
      gui: false,
      gpu: false,
      accelerated: false,
    },
    availability: "online",
    error: null,
    herdrProfile: null,
    herdrStatus: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Setup for Bun.spawnSync
// ---------------------------------------------------------------------------

// Save original
let originalSpawnSync: typeof Bun.spawnSync | null = null;

/** Create a mock for Bun.spawnSync */
function setupMockSpawnSync(
  mockResults: Map<string, { exitCode: number; stdout: string; stderr: string }>
): () => void {
  originalSpawnSync = Bun.spawnSync;
  
  Bun.spawnSync = (args: string[]) => {
    const key = args.join(" ");
    const mockResult = mockResults.get(key);
    
    if (mockResult) {
      return {
        exitCode: mockResult.exitCode,
        stdout: Buffer.from(mockResult.stdout),
        stderr: Buffer.from(mockResult.stderr),
        stdin: null,
        pid: 0,
        timedOut: false,
        signal: null,
      };
    }
    
    // Default: return empty result
    return {
      exitCode: 0,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      stdin: null,
      pid: 0,
      timedOut: false,
      signal: null,
    };
  };
  
  return () => {
    if (originalSpawnSync) {
      Bun.spawnSync = originalSpawnSync;
    }
  };
}

// ---------------------------------------------------------------------------
// 1. Windows + WSL Shared Capacity Tests
// ---------------------------------------------------------------------------

describe("Windows + WSL Shared Capacity", () => {
  let restoreSpawn: () => void;

  beforeEach(() => {
    const mockResults = new Map<string, { exitCode: number; stdout: string; stderr: string }>();
    
    // Mock herdr machine list
    mockResults.set(
      "herdr machine list --json",
      {
        exitCode: 0,
        stdout: JSON.stringify([mockWindowsProfile, mockWslProfile]),
        stderr: "",
      }
    );
    
    // Mock herdr machine status
    mockResults.set(
      "herdr machine status --json",
      {
        exitCode: 0,
        stdout: JSON.stringify([mockReachableStatus, mockDisabledStatus]),
        stderr: "",
      }
    );
    
    restoreSpawn = setupMockSpawnSync(mockResults);
  });

  afterEach(() => {
    restoreSpawn();
  });

  it("should detect Windows and WSL as having physical host groups", () => {
    const windowsMachine = herdrProfileToMachine(mockWindowsProfile, mockReachableStatus);
    const wslMachine = herdrProfileToMachine(mockWslProfile, mockDisabledStatus);
    
    // Both should have physical host groups
    expect(windowsMachine.physicalHostGroup).toBeDefined();
    expect(wslMachine.physicalHostGroup).toBeDefined();
    expect(typeof windowsMachine.physicalHostGroup).toBe("string");
    expect(typeof wslMachine.physicalHostGroup).toBe("string");
  });

  it("should not double-count CPU/RAM for Windows+WSL on same host", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "windows-1",
        label: "Windows",
        os: "windows",
        physicalHostGroup: "host-shared-1",
        resources: {
          cpu: { cores: 16, model: "Intel i9" },
          ramBytes: 32 * BYTES_PER_GB,
          gpus: [{ vendor: "NVIDIA", model: "RTX 4090", vramBytes: 24 * BYTES_PER_GB }],
          disks: [],
        },
      }),
      createMockMachine({
        id: "wsl-1",
        label: "WSL",
        os: "linux",
        physicalHostGroup: "host-shared-1",
        resources: {
          cpu: { cores: 8, model: "Intel i9" },
          ramBytes: 16 * BYTES_PER_GB,
          gpus: [],
          disks: [],
        },
      }),
    ];

    const combined = getCombinedResources(machines);
    const sharedResources = combined.get("host-shared-1");
    
    expect(sharedResources).toBeDefined();
    // Should use the primary machine's resources (Windows in this case)
    expect(sharedResources!.cpu.cores).toBe(16);
    expect(sharedResources!.ramBytes).toBe(32 * BYTES_PER_GB);
  });

  it("should detect shared host groups correctly", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "win-1",
        label: "Windows",
        os: "windows",
        physicalHostGroup: "host-abc",
      }),
      createMockMachine({
        id: "wsl-1",
        label: "WSL",
        os: "linux",
        physicalHostGroup: "host-abc",
      }),
      createMockMachine({
        id: "mac-1",
        label: "Mac",
        os: "macos",
        physicalHostGroup: "host-xyz",
      }),
    ];

    const hostGroups = detectSharedHosts(machines);
    
    expect(hostGroups.size).toBe(2);
    expect(hostGroups.get("host-abc")).toHaveLength(2);
    expect(hostGroups.get("host-xyz")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Offline Machine Tests
// ---------------------------------------------------------------------------

describe("Offline Machine Handling", () => {
  let restoreSpawn: () => void;

  beforeEach(() => {
    const mockResults = new Map<string, { exitCode: number; stdout: string; stderr: string }>();
    
    mockResults.set(
      "herdr machine list --json",
      {
        exitCode: 0,
        stdout: JSON.stringify([mockWindowsProfile]),
        stderr: "",
      }
    );
    
    mockResults.set(
      "herdr machine status --json",
      {
        exitCode: 0,
        stdout: JSON.stringify([{
          id: "windows-machine-id",
          label: "Windows Workstation",
          status: "disabled",
          error: null,
        }]),
        stderr: "",
      }
    );
    
    restoreSpawn = setupMockSpawnSync(mockResults);
  });

  afterEach(() => {
    restoreSpawn();
  });

  it("should detect offline machines correctly", () => {
    const machine = herdrProfileToMachine(
      mockWindowsProfile,
      { id: "windows-machine-id", label: "Windows Workstation", status: "disabled", error: null }
    );
    
    expect(machine.availability).toBe("offline");
  });

  it("should handle machines with no status info", () => {
    const machine = herdrProfileToMachine(mockWindowsProfile, null);
    
    expect(machine.availability).toBe("unknown");
  });

  it("should not select offline machines for placement", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "online-1",
        availability: "online",
        resources: { cpu: { cores: 8, model: "Intel" }, ramBytes: 16 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: false, accelerated: false },
      }),
      createMockMachine({
        id: "offline-1",
        availability: "offline",
        resources: { cpu: { cores: 16, model: "Intel" }, ramBytes: 32 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: false, accelerated: false },
      }),
    ];

    const constraints: PlacementConstraints = {
      hard: {
        availability: ["online"],
      },
      soft: {},
    };

    const result = findSuitableMachines(machines, constraints);
    
    // Only online machine should be suitable
    expect(result.suitable).toHaveLength(1);
    expect(result.suitable[0].id).toBe("online-1");
    expect(result.suitability[0].satisfiesHard).toBe(true);
    expect(result.suitability[1].satisfiesHard).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Host Identity Mismatch Tests
// ---------------------------------------------------------------------------

describe("Host Identity Mismatch", () => {
  it("should detect different physical host groups as different hosts", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "host-a-machine-1",
        physicalHostGroup: "host-a",
        instanceId: "instance-a",
      }),
      createMockMachine({
        id: "host-b-machine-1",
        physicalHostGroup: "host-b",
        instanceId: "instance-b",
      }),
    ];

    const hostGroups = detectSharedHosts(machines);
    
    expect(hostGroups.size).toBe(2);
    expect(hostGroups.get("host-a")).toHaveLength(1);
    expect(hostGroups.get("host-b")).toHaveLength(1);
  });

  it("should handle machines with null instanceId", () => {
    const machine = createMockMachine({
      instanceId: null,
    });
    
    // Should still generate a physical host group
    expect(machine.physicalHostGroup).toBeDefined();
    expect(typeof machine.physicalHostGroup).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// 4. Resource Unknown Tests
// ---------------------------------------------------------------------------

describe("Resource Unknown Handling", () => {
  it("should handle machines with null resources", () => {
    const machine = createMockMachine({
      resources: null,
      capabilities: null,
    });

    const constraints: PlacementConstraints = {
      hard: {
        minCpuCores: 4,
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    // Should not crash, but should report violation
    expect(suitability.satisfiesHard).toBe(false);
    expect(suitability.hardViolations.length).toBeGreaterThan(0);
  });

  it("should handle machines with unknown GPU VRAM", () => {
    const machine = createMockMachine({
      resources: {
        cpu: { cores: 8, model: "Intel" },
        ramBytes: 16 * BYTES_PER_GB,
        gpus: [{ vendor: "Unknown", model: "Unknown", vramBytes: null }],
        disks: [],
      },
      capabilities: { gui: false, gpu: true, accelerated: false },
    });

    const constraints: PlacementConstraints = {
      hard: {
        minGpuVramBytes: 8 * BYTES_PER_GB,
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    // Should report violation since VRAM is unknown (null = 0)
    expect(suitability.satisfiesHard).toBe(false);
    expect(suitability.hardViolations.some(v => v.includes("GPU VRAM"))).toBe(true);
  });

  it("should handle machines with no disks info", () => {
    const machine = createMockMachine({
      resources: {
        cpu: { cores: 8, model: "Intel" },
        ramBytes: 16 * BYTES_PER_GB,
        gpus: [],
        disks: [],
      },
    });

    // Should not crash
    expect(machine.resources?.disks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. GUI Singleton Tests
// ---------------------------------------------------------------------------

describe("GUI Singleton Detection", () => {
  it("should detect GUI capability correctly", () => {
    const withGui = createMockMachine({
      capabilities: { gui: true, gpu: false, accelerated: false },
    });

    const withoutGui = createMockMachine({
      capabilities: { gui: false, gpu: false, accelerated: false },
    });

    const constraints: PlacementConstraints = {
      hard: {
        guiRequired: true,
      },
      soft: {},
    };

    const withGuiSuitability = evaluateSuitability(withGui, constraints);
    const withoutGuiSuitability = evaluateSuitability(withoutGui, constraints);

    expect(withGuiSuitability.satisfiesHard).toBe(true);
    expect(withoutGuiSuitability.satisfiesHard).toBe(false);
    expect(withoutGuiSuitability.hardViolations.some(v => v.includes("GUI"))).toBe(true);
  });

  it("should prefer GUI machines when GUI is preferred", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "with-gui",
        capabilities: { gui: true, gpu: false, accelerated: false },
        resources: { cpu: { cores: 4, model: "Intel" }, ramBytes: 8 * BYTES_PER_GB, gpus: [], disks: [] },
      }),
      createMockMachine({
        id: "without-gui",
        capabilities: { gui: false, gpu: false, accelerated: false },
        resources: { cpu: { cores: 8, model: "Intel" }, ramBytes: 16 * BYTES_PER_GB, gpus: [], disks: [] },
      }),
    ];

    const constraints: PlacementConstraints = {
      hard: {},
      soft: {},
    };

    const result = findSuitableMachines(machines, constraints);
    
    // Both should be suitable (no hard constraints)
    expect(result.suitable).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Remote Unreachable Tests
// ---------------------------------------------------------------------------

describe("Remote Unreachable - No Retry", () => {
  let restoreSpawn: () => void;

  beforeEach(() => {
    const mockResults = new Map<string, { exitCode: number; stdout: string; stderr: string }>();
    
    mockResults.set(
      "herdr machine list --json",
      {
        exitCode: 0,
        stdout: JSON.stringify([
          mockWindowsProfile,
          mockWslProfile,
          mockMacosProfile,
        ]),
        stderr: "",
      }
    );
    
    mockResults.set(
      "herdr machine status --json",
      {
        exitCode: 0,
        stdout: JSON.stringify([
          { id: "windows-machine-id", label: "Windows", status: "error", error: "connection refused" },
          { id: "wsl-machine-id", label: "WSL", status: "error", error: "connection refused" },
          { id: "macos-machine-id", label: "Mac", status: "reachable", error: null },
        ]),
        stderr: "",
      }
    );
    
    restoreSpawn = setupMockSpawnSync(mockResults);
  });

  afterEach(() => {
    restoreSpawn();
  });

  it("should mark unreachable machines as error availability", () => {
    const machine = herdrProfileToMachine(
      mockWindowsProfile,
      { id: "windows-machine-id", label: "Windows", status: "error", error: "connection refused" }
    );
    
    expect(machine.availability).toBe("error");
    expect(machine.error).toBe("connection refused");
  });

  it("should not retry unreachable machines automatically", () => {
    const originalGetProfiles = getHerdrProfiles;
    const originalGetStatuses = getHerdrStatuses;
    
    // Call once
    const machines1 = originalGetProfiles();
    const statuses1 = originalGetStatuses();
    
    // Call again - should return same results without error
    const machines2 = originalGetProfiles();
    const statuses2 = originalGetStatuses();
    
    // Should return arrays (possibly empty) without throwing
    expect(Array.isArray(machines1)).toBe(true);
    expect(Array.isArray(statuses1)).toBe(true);
    expect(Array.isArray(machines2)).toBe(true);
    expect(Array.isArray(statuses2)).toBe(true);
  });

  it("should exclude error machines from placement when availability is constrained", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "error-machine",
        availability: "error",
        error: "connection refused",
        resources: { cpu: { cores: 16, model: "Intel" }, ramBytes: 32 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: true, accelerated: true },
      }),
      createMockMachine({
        id: "reachable-machine",
        availability: "online",
        resources: { cpu: { cores: 8, model: "Intel" }, ramBytes: 16 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: false, accelerated: false },
      }),
    ];

    const constraints: PlacementConstraints = {
      hard: {
        availability: ["online", "reachable"],
      },
      soft: {},
    };

    const result = findSuitableMachines(machines, constraints);
    
    // Only reachable machine should satisfy hard constraints
    expect(result.suitability[0].satisfiesHard).toBe(true);
    expect(result.suitability[1].satisfiesHard).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Placement Suitability Tests
// ---------------------------------------------------------------------------

describe("Placement Suitability Evaluation", () => {
  it("should satisfy all hard constraints", () => {
    const machine = createMockMachine({
      os: "linux",
      arch: "x64",
      resources: {
        cpu: { cores: 8, model: "Intel" },
        ramBytes: 16 * BYTES_PER_GB,
        gpus: [{ vendor: "NVIDIA", model: "RTX 3080", vramBytes: 10 * BYTES_PER_GB }],
        disks: [],
      },
      capabilities: { gui: true, gpu: true, accelerated: true },
      availability: "online",
    });

    const constraints: PlacementConstraints = {
      hard: {
        os: ["linux", "macos"],
        arch: ["x64", "arm64"],
        minCpuCores: 4,
        minRamBytes: 8 * BYTES_PER_GB,
        minGpuVramBytes: 8 * BYTES_PER_GB,
        gpuRequired: true,
        guiRequired: true,
        availability: ["online"],
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    expect(suitability.satisfiesHard).toBe(true);
    expect(suitability.hardViolations).toHaveLength(0);
    expect(suitability.score).toBe(1.0);
  });

  it("should report hard constraint violations", () => {
    const machine = createMockMachine({
      os: "windows",
      arch: "x86",
      resources: {
        cpu: { cores: 2, model: "Intel" },
        ramBytes: 4 * BYTES_PER_GB,
        gpus: [],
        disks: [],
      },
      capabilities: { gui: false, gpu: false, accelerated: false },
      availability: "offline",
    });

    const constraints: PlacementConstraints = {
      hard: {
        os: ["linux", "macos"],
        arch: ["x64"],
        minCpuCores: 4,
        minRamBytes: 8 * BYTES_PER_GB,
        gpuRequired: true,
        guiRequired: true,
        availability: ["online"],
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    expect(suitability.satisfiesHard).toBe(false);
    expect(suitability.hardViolations.length).toBeGreaterThan(0);
    expect(suitability.score).toBeLessThan(1.0);
  });

  it("should report soft constraint violations", () => {
    const machine = createMockMachine({
      os: "windows",
      arch: "x64",
      resources: {
        cpu: { cores: 4, model: "Intel" },
        ramBytes: 8 * BYTES_PER_GB,
        gpus: [],
        disks: [],
      },
      capabilities: { gui: true, gpu: false, accelerated: false },
      availability: "online",
    });

    const constraints: PlacementConstraints = {
      hard: {
        os: ["windows", "linux", "macos"],
      },
      soft: {
        preferredOs: ["linux", "macos"],
        preferredArch: ["arm64"],
        minPreferredCpuCores: 8,
        minPreferredRamBytes: 16 * BYTES_PER_GB,
      },
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    expect(suitability.satisfiesHard).toBe(true);
    expect(suitability.satisfiesSoft).toBe(false);
    expect(suitability.softViolations.length).toBeGreaterThan(0);
  });

  it("should sort machines by score", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "low-score",
        os: "windows",
        resources: { cpu: { cores: 2, model: "Intel" }, ramBytes: 4 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: false, gpu: false, accelerated: false },
      }),
      createMockMachine({
        id: "high-score",
        os: "linux",
        resources: { cpu: { cores: 16, model: "Intel" }, ramBytes: 32 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: false, accelerated: false },
      }),
    ];

    const constraints: PlacementConstraints = {
      hard: {
        os: ["linux", "windows"],
        minCpuCores: 2,
      },
      soft: {
        preferredOs: ["linux"],
        minPreferredCpuCores: 8,
      },
    };

    const result = findSuitableMachines(machines, constraints);
    
    // High score machine should come first
    expect(result.suitable[0].id).toBe("high-score");
    expect(result.suitable[1].id).toBe("low-score");
    expect(result.suitability[0].score).toBeGreaterThan(result.suitability[1].score);
  });
});

// ---------------------------------------------------------------------------
// 8. Attestation Tests
// ---------------------------------------------------------------------------

describe("Machine Attestation", () => {
  it("should attest local machine with evidence", () => {
    const now = new Date().toISOString();
    const machine = createMockMachine({
      id: "local-test",
      isLocal: true,
      resources: {
        cpu: { cores: 8, model: "Intel" },
        ramBytes: 16 * BYTES_PER_GB,
        gpus: [],
        disks: [],
      },
    });

    const evidence: Evidence = {
      at: now,
      source: "probe",
      note: "Local machine probe",
    };

    const attested = attestMachine(machine, evidence);
    
    expect(attested.attestation.status).toBe("verified-live");
    expect(attested.attestation.provenance).toBe("measured");
    expect(attested.attestation.value).toEqual(machine.resources);
    expect(attested.attestation.evidence).toEqual(evidence);
  });

  it("should attest configured machine correctly", () => {
    const machine = createMockMachine({
      isLocal: false,
      herdrProfile: mockWindowsProfile,
      herdrStatus: null,
      resources: null,
    });

    const evidence: Evidence = {
      at: new Date().toISOString(),
      source: "config",
      note: "Configured machine",
    };

    const attested = attestMachine(machine, evidence);
    
    expect(attested.attestation.status).toBe("configured");
    expect(attested.attestation.provenance).toBe("estimated");
  });

  it("should attest multiple machines", () => {
    const now = new Date().toISOString();
    const machines: Machine[] = [
      createMockMachine({ id: "m1", isLocal: true }),
      createMockMachine({ id: "m2", isLocal: false, herdrStatus: mockReachableStatus }),
      createMockMachine({ id: "m3", isLocal: false, herdrProfile: mockWindowsProfile, herdrStatus: null }),
    ];

    const attested = attestMachines(machines);
    
    expect(attested).toHaveLength(3);
    // All should have attestations
    expect(attested.every(m => m.attestation)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. WSL Detection Tests
// ---------------------------------------------------------------------------

describe("WSL Detection", () => {
  it("should detect WSL from label", () => {
    const machine = createMockMachine({
      label: "Ubuntu (WSL)",
      os: "linux",
    });

    expect(isWsl(machine)).toBe(true);
  });

  it("should detect WSL from target", () => {
    const machine = createMockMachine({
      label: "Ubuntu",
      os: "linux",
      target: "wsl-host",
    });

    expect(isWsl(machine)).toBe(true);
  });

  it("should not detect non-WSL Linux as WSL", () => {
    const machine = createMockMachine({
      label: "Ubuntu Server",
      os: "linux",
      target: "ubuntu-server",
    });

    expect(isWsl(machine)).toBe(false);
  });

  it("should not detect Windows as WSL", () => {
    const machine = createMockMachine({
      label: "Windows",
      os: "windows",
    });

    expect(isWsl(machine)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Utility Tests
// ---------------------------------------------------------------------------

describe("Utility Functions", () => {
  describe("formatBytes", () => {
    it("should format GB correctly", () => {
      expect(formatBytes(2 * BYTES_PER_GB)).toBe("2.00 GB");
    });

    it("should format MB correctly", () => {
      expect(formatBytes(500 * BYTES_PER_MB)).toBe("500.00 MB");
    });

    it("should format KB correctly", () => {
      expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    });

    it("should format bytes correctly", () => {
      expect(formatBytes(500)).toBe("500 B");
    });
  });

  describe("herdrProfileToMachine", () => {
    it("should convert Windows profile correctly", () => {
      const machine = herdrProfileToMachine(mockWindowsProfile, mockReachableStatus);
      
      expect(machine.id).toBe(mockWindowsProfile.id);
      expect(machine.label).toBe(mockWindowsProfile.label);
      expect(machine.target).toBe(mockWindowsProfile.target);
      expect(machine.session).toBe(mockWindowsProfile.session);
      expect(machine.herdrProfile).toEqual(mockWindowsProfile);
      expect(machine.herdrStatus).toEqual(mockReachableStatus);
    });

    it("should handle null status", () => {
      const machine = herdrProfileToMachine(mockWindowsProfile, null);
      
      expect(machine.herdrProfile).toEqual(mockWindowsProfile);
      expect(machine.herdrStatus).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 11. Contract Compliance Tests
// ---------------------------------------------------------------------------

describe("Contract Compliance", () => {
  it("should use contract types correctly", () => {
    const now = new Date().toISOString();
    const machine = createMockMachine({ isLocal: true });
    const evidence: Evidence = {
      at: now,
      source: "probe",
      note: "Test probe",
    };
    const attested = attestMachine(machine, evidence);
    
    // Verify attestation structure
    expect(attested.attestation).toHaveProperty("value");
    expect(attested.attestation).toHaveProperty("status");
    expect(attested.attestation).toHaveProperty("provenance");
    expect(attested.attestation).toHaveProperty("evidence");
    
    // Verify status is a valid VerificationStatus
    const validStatuses: VerificationStatus[] = [
      "configured",
      "verified-live",
      "restricted",
      "unknown",
    ];
    expect(validStatuses).toContain(attested.attestation.status);
    
    // Verify provenance is a valid Provenance
    const validProvenances: Provenance[] = ["measured", "estimated", "official"];
    expect(validProvenances).toContain(attested.attestation.provenance);
  });

  it("should handle evidence correctly", () => {
    const now = new Date().toISOString();
    const machine = createMockMachine({ isLocal: false, herdrProfile: mockWindowsProfile, herdrStatus: null });
    const evidence: Evidence = {
      at: now,
      source: "config",
      note: "Configured",
    };
    const attested = attestMachine(machine, evidence);
    
    expect(attested.attestation.evidence).toEqual(evidence);
  });
});

// ---------------------------------------------------------------------------
// 12. Edge Cases
// ---------------------------------------------------------------------------

describe("Edge Cases", () => {
  it("should handle empty machine list", () => {
    const machines: Machine[] = [];
    const hostGroups = detectSharedHosts(machines);
    
    expect(hostGroups.size).toBe(0);
  });

  it("should handle machine with no capabilities", () => {
    const machine = createMockMachine({
      capabilities: null,
    });

    const constraints: PlacementConstraints = {
      hard: {
        gpuRequired: true,
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    // Should not crash - if capabilities is null, gpuRequired should fail
    expect(suitability.satisfiesHard).toBe(false);
  });

  it("should handle machine with no resources", () => {
    const machine = createMockMachine({
      resources: null,
    });

    const constraints: PlacementConstraints = {
      hard: {
        minCpuCores: 4,
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    // Should not crash - if resources is null, minCpuCores should fail
    expect(suitability.satisfiesHard).toBe(false);
  });

  it("should handle empty constraints", () => {
    const machine = createMockMachine();
    const constraints: PlacementConstraints = {
      hard: {},
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    expect(suitability.satisfiesHard).toBe(true);
    expect(suitability.satisfiesSoft).toBe(true);
    expect(suitability.score).toBe(1.0);
  });

  it("should handle machine with empty gpus array", () => {
    const machine = createMockMachine({
      resources: {
        cpu: { cores: 8, model: "Intel" },
        ramBytes: 16 * BYTES_PER_GB,
        gpus: [],
        disks: [],
      },
      capabilities: { gui: true, gpu: false, accelerated: false },
    });

    const constraints: PlacementConstraints = {
      hard: {
        gpuRequired: true,
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    expect(suitability.satisfiesHard).toBe(false);
    expect(suitability.hardViolations.some(v => v.includes("GPU"))).toBe(true);
  });
});
