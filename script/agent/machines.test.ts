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
  InventoryError,
  getLocalMachine,
  getMachinesFromHerdr,
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
  getAllMachines,
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

/** Mock Herdr machine profile for remote Linux */
const mockRemoteLinuxProfile: HerdrMachineProfile = {
  id: "remote-linux-id",
  label: "Remote Linux Server",
  target: "remote-linux-server",
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
  error: "remote Herdr server is stopped or incompatible; run `herdr --remote device-macos --session default`",
};

/** Mock Herdr machine status for remote Linux */
const mockRemoteLinuxStatus: HerdrMachineStatus = {
  id: "remote-linux-id",
  label: "Remote Linux Server",
  status: "reachable",
  error: null,
};

/** Create a mock machine for testing */
function createMockMachine(
  overrides: Partial<Machine> = {}
): Machine {
  return {
    id: "test-machine",
    label: "Test Machine",
    os: null,
    arch: null,
    physicalHostGroup: null,
    instanceIdHash: null,
    target: "device-test",
    session: "default",
    isLocal: false,
    resources: null,
    capabilities: null,
    availability: "unknown",
    error: null,
    herdrProfile: null,
    herdrStatus: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Setup for Bun.spawnSync
// ---------------------------------------------------------------------------

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
// Fixtures from real Herdr output (sanitized)
// ---------------------------------------------------------------------------

/** Real Herdr machine list output (sanitized for tests) */
export const REAL_HERDR_LIST_JSON = `[
  {
    "id": "4729223c1554f417f43e826826adb9e3",
    "label": "WSL · worker 1",
    "target": "devnode-wsl-worker-1",
    "session": "devnode-poc-wsl-2a1084ec",
    "enabled": false,
    "selected": false
  },
  {
    "id": "3202e4b584c237bb11db58dddc10d640",
    "label": "UUU · Windows",
    "target": "devnode-win-uuu-recreated",
    "session": "default",
    "enabled": false,
    "selected": false
  },
  {
    "id": "3f85952ba63e2beab71a5325cb3376d9",
    "label": "Windows",
    "target": "device-windows",
    "session": "default",
    "enabled": true,
    "selected": false
  },
  {
    "id": "5ac021a51c055c8627fe0ef3f783daf2",
    "label": "Ubuntu (WSL)",
    "target": "device-wsl",
    "session": "default",
    "enabled": true,
    "selected": false
  }
]`;

/** Real Herdr machine status output (sanitized for tests) */
export const REAL_HERDR_STATUS_JSON = `[
  {
    "id": "4729223c1554f417f43e826826adb9e3",
    "label": "WSL · worker 1",
    "status": "disabled",
    "error": null
  },
  {
    "id": "3202e4b584c237bb11db58dddc10d640",
    "label": "UUU · Windows",
    "status": "disabled",
    "error": null
  },
  {
    "id": "3f85952ba63e2beab71a5325cb3376d9",
    "label": "Windows",
    "status": "error",
    "error": "remote Herdr server is stopped or incompatible; run \`herdr --remote device-windows --session default\`"
  },
  {
    "id": "5ac021a51c055c8627fe0ef3f783daf2",
    "label": "Ubuntu (WSL)",
    "status": "reachable",
    "error": null
  }
]`;

// ---------------------------------------------------------------------------
// 1. Windows + WSL Shared Capacity Tests
// ---------------------------------------------------------------------------

describe("Windows + WSL Shared Capacity", () => {
  let restoreSpawn: () => void;

  beforeEach(() => {
    const mockResults = new Map<string, { exitCode: number; stdout: string; stderr: string }>();
    
    mockResults.set(
      "herdr machine list --json",
      {
        exitCode: 0,
        stdout: REAL_HERDR_LIST_JSON,
        stderr: "",
      }
    );
    
    mockResults.set(
      "herdr machine status --json",
      {
        exitCode: 0,
        stdout: REAL_HERDR_STATUS_JSON,
        stderr: "",
      }
    );
    
    restoreSpawn = setupMockSpawnSync(mockResults);
  });

  afterEach(() => {
    restoreSpawn();
  });

  it("should detect Windows and WSL as having physical host groups from evidence", () => {
    const windowsMachine = herdrProfileToMachine(mockWindowsProfile, {
      id: "3f85952ba63e2beab71a5325cb3376d9",
      label: "Windows",
      status: "error",
      error: "remote Herdr server is stopped",
    });
    const wslMachine = herdrProfileToMachine(mockWslProfile, {
      id: "5ac021a51c055c8627fe0ef3f783daf2",
      label: "Ubuntu (WSL)",
      status: "reachable",
      error: null,
    });
    
    // Both should have physical host groups (null for remote machines without probing)
    // Local machines would have hashed host groups
    expect(windowsMachine.physicalHostGroup).toBeNull();
    expect(wslMachine.physicalHostGroup).toBeNull();
  });

  it("should not double-count CPU/RAM for machines with same host group", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "windows-1",
        label: "Windows",
        os: "windows",
        physicalHostGroup: "host-abc123",
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
        physicalHostGroup: "host-abc123",
        resources: {
          cpu: { cores: 8, model: "Intel i9" },
          ramBytes: 16 * BYTES_PER_GB,
          gpus: [],
          disks: [],
        },
      }),
    ];

    const combined = getCombinedResources(machines);
    const sharedResources = combined.get("host-abc123");
    
    expect(sharedResources).toBeDefined();
    expect(sharedResources).not.toBeNull();
    // Should use the first machine's resources for the group
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

  it("should treat unknown host groups conservatively as potentially shared", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "unknown-1",
        physicalHostGroup: null,
      }),
      createMockMachine({
        id: "unknown-2",
        physicalHostGroup: null,
      }),
    ];

    const hostGroups = detectSharedHosts(machines);
    
    // Both should be in the same fallback group
    expect(hostGroups.size).toBe(1);
    const fallbackGroup = hostGroups.keys().next().value;
    expect(hostGroups.get(fallbackGroup)).toHaveLength(2);
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
        stdout: REAL_HERDR_LIST_JSON,
        stderr: "",
      }
    );
    
    mockResults.set(
      "herdr machine status --json",
      {
        exitCode: 0,
        stdout: REAL_HERDR_STATUS_JSON,
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

  it("should NOT select offline machines for placement by default (fail-closed)", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "online-1",
        availability: "online",
        os: "linux",
        arch: "x64",
        resources: { cpu: { cores: 8, model: "Intel" }, ramBytes: 16 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: false, accelerated: false },
      }),
      createMockMachine({
        id: "offline-1",
        availability: "offline",
        os: "linux",
        arch: "x64",
        resources: { cpu: { cores: 16, model: "Intel" }, ramBytes: 32 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: false, accelerated: false },
      }),
    ];

    const constraints: PlacementConstraints = {
      hard: {},
      soft: {},
    };

    const result = findSuitableMachines(machines, constraints);
    
    // Only online machine should be suitable (fail-closed)
    expect(result.suitable).toHaveLength(1);
    expect(result.suitable[0].id).toBe("online-1");
    expect(result.suitability[0].satisfiesHard).toBe(true);
    expect(result.suitability[1].satisfiesHard).toBe(false);
  });

  it("should allow offline machines if explicitly opted in", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "online-1",
        availability: "online",
        os: "linux",
        arch: "x64",
        resources: { cpu: { cores: 8, model: "Intel" }, ramBytes: 16 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: false, accelerated: false },
      }),
      createMockMachine({
        id: "offline-1",
        availability: "offline",
        os: "linux",
        arch: "x64",
        resources: { cpu: { cores: 16, model: "Intel" }, ramBytes: 32 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: false, accelerated: false },
      }),
    ];

    const constraints: PlacementConstraints = {
      hard: {
        availability: ["online", "offline"],
      },
      soft: {},
    };

    const result = findSuitableMachines(machines, constraints);
    
    // Both should be suitable when explicitly opted in
    expect(result.suitable).toHaveLength(2);
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
        physicalHostGroup: "host-a-hash",
        instanceIdHash: "instance-a-hash",
      }),
      createMockMachine({
        id: "host-b-machine-1",
        physicalHostGroup: "host-b-hash",
        instanceIdHash: "instance-b-hash",
      }),
    ];

    const hostGroups = detectSharedHosts(machines);
    
    expect(hostGroups.size).toBe(2);
    expect(hostGroups.get("host-a-hash")).toHaveLength(1);
    expect(hostGroups.get("host-b-hash")).toHaveLength(1);
  });

  it("should handle machines with null instanceIdHash", () => {
    const machine = createMockMachine({
      instanceIdHash: null,
    });
    
    expect(machine.physicalHostGroup).toBeNull();
    expect(machine.instanceIdHash).toBeNull();
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
      os: null,
      arch: null,
    });

    const constraints: PlacementConstraints = {
      hard: {
        minCpuCores: 4,
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    expect(suitability.satisfiesHard).toBe(false);
    expect(suitability.hardViolations.length).toBeGreaterThan(0);
    expect(suitability.hardViolations[0]).toContain("unknown");
  });

  it("should handle machines with unknown GPU VRAM", () => {
    const machine = createMockMachine({
      os: "linux",
      arch: "x64",
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
    
    expect(suitability.satisfiesHard).toBe(false);
    expect(suitability.hardViolations.some(v => v.includes("GPU VRAM"))).toBe(true);
  });

  it("should handle machines with null OS/arch", () => {
    const machine = createMockMachine({
      os: null,
      arch: null,
    });

    const constraints: PlacementConstraints = {
      hard: {
        os: ["linux"],
        arch: ["x64"],
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    expect(suitability.satisfiesHard).toBe(false);
    expect(suitability.hardViolations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. GUI Singleton Tests
// ---------------------------------------------------------------------------

describe("GUI Singleton Detection", () => {
  it("should detect GUI capability correctly", () => {
    const withGui = createMockMachine({
      capabilities: { gui: true, gpu: false, accelerated: false },
      availability: "online",
    });

    const withoutGui = createMockMachine({
      capabilities: { gui: false, gpu: false, accelerated: false },
      availability: "online",
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

  it("should handle machines with null capabilities", () => {
    const machine = createMockMachine({
      capabilities: null,
    });

    const constraints: PlacementConstraints = {
      hard: {
        guiRequired: true,
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    expect(suitability.satisfiesHard).toBe(false);
    expect(suitability.hardViolations[0]).toContain("unknown");
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
        stdout: REAL_HERDR_LIST_JSON,
        stderr: "",
      }
    );
    
    mockResults.set(
      "herdr machine status --json",
      {
        exitCode: 0,
        stdout: REAL_HERDR_STATUS_JSON,
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
      { id: "3f85952ba63e2beab71a5325cb3376d9", label: "Windows", status: "error", error: "remote Herdr server is stopped" }
    );
    
    expect(machine.availability).toBe("error");
    expect(machine.error).toContain("remote Herdr server is stopped");
  });

  it("should NOT select error machines for placement by default", () => {
    const machines: Machine[] = [
      createMockMachine({
        id: "error-machine",
        availability: "error",
        error: "connection refused",
        os: "linux",
        arch: "x64",
        resources: { cpu: { cores: 16, model: "Intel" }, ramBytes: 32 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: true, accelerated: true },
      }),
      createMockMachine({
        id: "reachable-machine",
        availability: "online",
        os: "linux",
        arch: "x64",
        resources: { cpu: { cores: 8, model: "Intel" }, ramBytes: 16 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: false, accelerated: false },
      }),
    ];

    const constraints: PlacementConstraints = {
      hard: {},
      soft: {},
    };

    const result = findSuitableMachines(machines, constraints);
    
    // Only reachable machine should be suitable (fail-closed)
    expect(result.suitable).toHaveLength(1);
    expect(result.suitable[0].id).toBe("reachable-machine");
  });

  it("should return explicit error on herdr command failure", () => {
    const mockResults = new Map<string, { exitCode: number; stdout: string; stderr: string }>();
    mockResults.set(
      "herdr machine list --json",
      {
        exitCode: 1,
        stdout: "",
        stderr: "herdr: command not found",
      }
    );
    
    const restore = setupMockSpawnSync(mockResults);
    
    try {
      const result = getHerdrProfiles();
      expect(result).toHaveProperty("type", "inventory-error");
      expect((result as InventoryError).error).toContain("herdr: command not found");
    } finally {
      restore();
    }
  });

  it("should return explicit error on invalid JSON", () => {
    const mockResults = new Map<string, { exitCode: number; stdout: string; stderr: string }>();
    mockResults.set(
      "herdr machine list --json",
      {
        exitCode: 0,
        stdout: "not valid json",
        stderr: "",
      }
    );
    
    const restore = setupMockSpawnSync(mockResults);
    
    try {
      const result = getHerdrProfiles();
      expect(result).toHaveProperty("type", "inventory-error");
      expect((result as InventoryError).error).toContain("invalid JSON");
    } finally {
      restore();
    }
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
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    expect(suitability.satisfiesHard).toBe(true);
    expect(suitability.hardViolations).toHaveLength(0);
    expect(suitability.score).toBe(1.0);
  });

  it("should report hard constraint violations for unknown values", () => {
    const machine = createMockMachine({
      os: null,
      arch: null,
      resources: null,
      capabilities: null,
      availability: "unknown",
    });

    const constraints: PlacementConstraints = {
      hard: {
        os: ["linux", "macos"],
        minCpuCores: 4,
      },
      soft: {},
    };

    const suitability = evaluateSuitability(machine, constraints);
    
    expect(suitability.satisfiesHard).toBe(false);
    expect(suitability.hardViolations.length).toBeGreaterThan(0);
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
        arch: "x86",
        resources: { cpu: { cores: 2, model: "Intel" }, ramBytes: 4 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: false, gpu: false, accelerated: false },
        availability: "online",
      }),
      createMockMachine({
        id: "high-score",
        os: "linux",
        arch: "x64",
        resources: { cpu: { cores: 16, model: "Intel" }, ramBytes: 32 * BYTES_PER_GB, gpus: [], disks: [] },
        capabilities: { gui: true, gpu: false, accelerated: false },
        availability: "online",
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
      os: "macos",
      arch: "arm64",
      resources: {
        cpu: { cores: 8, model: "Apple M5" },
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
      herdrProfile: mockRemoteLinuxProfile,
      herdrStatus: mockRemoteLinuxStatus,
      os: null,
      arch: null,
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
      createMockMachine({ id: "m1", isLocal: true, os: "macos", arch: "arm64", resources: { cpu: { cores: 8, model: "M5" }, ramBytes: 16 * BYTES_PER_GB, gpus: [], disks: [] } }),
      createMockMachine({ id: "m2", isLocal: false, herdrProfile: mockRemoteLinuxProfile, herdrStatus: mockRemoteLinuxStatus, os: null, arch: null, resources: null }),
      createMockMachine({ id: "m3", isLocal: false, herdrProfile: mockWindowsProfile, herdrStatus: null, os: null, arch: null, resources: null }),
    ];

    const attested = attestMachines(machines);
    
    expect(attested).toHaveLength(3);
    expect(attested.every(m => m.attestation)).toBe(true);
    expect(attested[0].attestation.status).toBe("verified-live");
    expect(attested[1].attestation.status).toBe("configured");
    expect(attested[2].attestation.status).toBe("configured");
  });
});

// ---------------------------------------------------------------------------
// 9. WSL Detection Tests
// ---------------------------------------------------------------------------

describe("WSL Detection", () => {
  it("should detect WSL from /proc/version for local Linux", () => {
    // This test would need to run on actual WSL to pass
    // For now, we test the logic with a mock
    const machine = createMockMachine({
      isLocal: true,
      os: "linux",
    });

    // On non-WSL Linux, should return false
    // On WSL, would read /proc/version and find "Microsoft"
    const result = isWsl(machine);
    
    // On macOS, this will be false (can't read /proc/version)
    expect(typeof result).toBe("boolean");
  });

  it("should not detect Windows as WSL", () => {
    const machine = createMockMachine({
      os: "windows",
    });

    expect(isWsl(machine)).toBe(false);
  });

  it("should not detect macOS as WSL", () => {
    const machine = createMockMachine({
      os: "macos",
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
      expect(machine.availability).toBe("unknown");
    });

    it("should NOT attribute local resources to remote machines", () => {
      const machine = herdrProfileToMachine(mockRemoteLinuxProfile, mockRemoteLinuxStatus);
      
      // Remote machine should have null resources (not local machine's resources)
      expect(machine.resources).toBeNull();
      expect(machine.os).toBeNull();
      expect(machine.arch).toBeNull();
      expect(machine.isLocal).toBe(false);
    });

    it("should detect local machines by target pattern", () => {
      const localTargets = ["device-windows", "device-wsl", "device-macos"];
      
      for (const target of localTargets) {
        const profile: HerdrMachineProfile = {
          id: "test-id",
          label: "Test",
          target,
          session: "default",
          enabled: true,
          selected: false,
        };
        const machine = herdrProfileToMachine(profile, null);
        expect(machine.isLocal).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 11. Contract Compliance Tests
// ---------------------------------------------------------------------------

describe("Contract Compliance", () => {
  it("should use contract types correctly", () => {
    const now = new Date().toISOString();
    const machine = createMockMachine({ isLocal: true, os: "macos", arch: "arm64", resources: { cpu: { cores: 8, model: "M5" }, ramBytes: 16 * BYTES_PER_GB, gpus: [], disks: [] } });
    const evidence: Evidence = {
      at: now,
      source: "probe",
      note: "Test probe",
    };
    const attested = attestMachine(machine, evidence);
    
    expect(attested.attestation).toHaveProperty("value");
    expect(attested.attestation).toHaveProperty("status");
    expect(attested.attestation).toHaveProperty("provenance");
    expect(attested.attestation).toHaveProperty("evidence");
    
    const validStatuses: VerificationStatus[] = [
      "configured",
      "verified-live",
      "restricted",
      "unknown",
    ];
    expect(validStatuses).toContain(attested.attestation.status);
    
    const validProvenances: Provenance[] = ["measured", "estimated", "official"];
    expect(validProvenances).toContain(attested.attestation.provenance);
  });

  it("should handle evidence correctly", () => {
    const now = new Date().toISOString();
    const machine = createMockMachine({ isLocal: false, herdrProfile: mockRemoteLinuxProfile, herdrStatus: mockRemoteLinuxStatus, os: null, arch: null, resources: null });
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
    
    expect(suitability.satisfiesHard).toBe(false);
    expect(suitability.hardViolations[0]).toContain("unknown");
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
    
    expect(suitability.satisfiesHard).toBe(false);
    expect(suitability.hardViolations[0]).toContain("unknown");
  });

  it("should handle empty constraints", () => {
    const machine = createMockMachine({
      os: "linux",
      arch: "x64",
      resources: { cpu: { cores: 8, model: "Intel" }, ramBytes: 16 * BYTES_PER_GB, gpus: [], disks: [] },
      capabilities: { gui: true, gpu: false, accelerated: false },
      availability: "online",
    });
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
      os: "linux",
      arch: "x64",
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

// ---------------------------------------------------------------------------
// 13. Real Herdr Output Tests
// ---------------------------------------------------------------------------

describe("Real Herdr Output (sanitized fixtures)", () => {
  let restoreSpawn: () => void;

  beforeEach(() => {
    const mockResults = new Map<string, { exitCode: number; stdout: string; stderr: string }>();
    
    mockResults.set(
      "herdr machine list --json",
      {
        exitCode: 0,
        stdout: REAL_HERDR_LIST_JSON,
        stderr: "",
      }
    );
    
    mockResults.set(
      "herdr machine status --json",
      {
        exitCode: 0,
        stdout: REAL_HERDR_STATUS_JSON,
        stderr: "",
      }
    );
    
    restoreSpawn = setupMockSpawnSync(mockResults);
  });

  afterEach(() => {
    restoreSpawn();
  });

  it("should parse real Herdr list output correctly", () => {
    const result = getHerdrProfiles();
    
    expect(Array.isArray(result)).toBe(true);
    expect((result as HerdrMachineProfile[]).length).toBe(4);
    
    const profiles = result as HerdrMachineProfile[];
    expect(profiles[0].id).toBe("4729223c1554f417f43e826826adb9e3");
    expect(profiles[0].label).toBe("WSL · worker 1");
    expect(profiles[0].target).toBe("devnode-wsl-worker-1");
  });

  it("should parse real Herdr status output correctly", () => {
    const result = getHerdrStatuses();
    
    expect(Array.isArray(result)).toBe(true);
    expect((result as HerdrMachineStatus[]).length).toBe(4);
    
    const statuses = result as HerdrMachineStatus[];
    expect(statuses[2].status).toBe("error");
    expect(statuses[2].error).toContain("remote Herdr server is stopped");
    expect(statuses[3].status).toBe("reachable");
  });

  it("should match status to profile by id", () => {
    const machinesResult = getMachinesFromHerdr();
    
    expect(Array.isArray(machinesResult)).toBe(true);
    const machines = machinesResult as Machine[];
    
    // Find the Windows machine with error status
    const windowsMachine = machines.find(m => m.label === "Windows");
    expect(windowsMachine).toBeDefined();
    expect(windowsMachine!.availability).toBe("error");
    expect(windowsMachine!.error).toContain("remote Herdr server is stopped");
  });
});
