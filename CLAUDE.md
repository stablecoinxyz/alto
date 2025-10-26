# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alto is a TypeScript implementation of the ERC-4337 bundler specification developed by Pimlico. It processes UserOperations (user transactions) through EntryPoint contracts (v0.6 and v0.7), handling validation, mempool management, bundling, and on-chain execution.

## Development Commands

### Building
```bash
pnpm install
pnpm build                    # Builds all workspaces (TypeScript compilation + alias resolution)
pnpm build:esm                # Builds ESM modules only
```

The build compiles TypeScript in `src/` and generates output to `src/lib/` (CommonJS) and `src/esm/` (ES modules).

### Running Alto
```bash
# Production mode
./alto --entrypoints "0x5FF1...2789" --executor-private-keys "..." --rpc-url "http://localhost:8545" --network-name "local"

# Development mode with auto-reload
pnpm dev

# See all CLI options
./alto help

# Local testing with Anvil (requires Foundry)
./scripts/run-local-instance.sh -l                           # Local mode
./scripts/run-local-instance.sh -f -r <rpc-url> -b <block>  # Fork mode
```

### Testing
```bash
pnpm test                     # Runs e2e tests (requires Foundry installed)
pnpm test:ci                  # CI test mode
pnpm test:spec                # Runs bundler-spec-tests compliance suite

# E2E testing setup
cd test/e2e
docker-compose up             # Starts local Anvil node with deployed contracts
pnpm test                     # Runs vitest test suite
```

E2E tests deploy EntryPoint contracts (v0.6 and v0.7) and SimpleAccountFactory contracts to deterministic addresses.

### Linting and Formatting
```bash
pnpm lint                     # Check code with Biome
pnpm lint:fix                 # Auto-fix issues
pnpm format                   # Format code with Biome
```

### Running Individual Tests
```bash
cd test/e2e
pnpm test tests/userOp.test.ts           # Run specific test file
pnpm test -t "test name pattern"         # Run tests matching pattern
```

## Architecture Overview

Alto uses a modular pipeline architecture with clear separation of concerns:

### Core Components

**1. RPC Handler** (`src/rpc/rpcHandler.ts`)
- Entry point for all JSON-RPC requests (eth_sendUserOperation, eth_estimateUserOperationGas, etc.)
- Validates UserOperations via pre-mempool checks (gas limits, nonce, prefund)
- Routes to 18+ RPC method handlers
- Supports both EntryPoint v0.6 and v0.7

**2. Validation System** (`src/rpc/validation/`)
- Two modes controlled by `--safeMode` flag:
  - **SafeValidator**: Uses `debug_traceCall` with custom Geth tracers (BundlerCollectorTracerV06/V07) to enforce storage access rules and validate opcodes. Required for spec compliance.
  - **UnsafeValidator**: Lightweight simulation via EntryPoint contract calls. Faster but less strict.
- Validates sender balance, gas limits, paymasters, and factory deployments
- Returns storage maps and referenced code hashes for bundle composition

**3. Mempool** (`src/mempool/mempool.ts`)
- Manages three operation states: Outstanding → Processing → Submitted
- Handles operation replacement (requires 10% gas price bump)
- Enforces reputation system (throttles/bans bad actors in safe mode)
- Composes bundles via `getBundles()`:
  - Groups by EntryPoint
  - Respects gas limits and entity constraints
  - Validates storage access consistency (prevents cross-bundle conflicts)
  - Checks paymaster deposits
- Supports memory store (single instance) or Redis (distributed/horizontal scaling)

**4. Executor** (`src/executor/executor.ts`)
- Submits bundles on-chain via `handleOps` EntryPoint call
- Gas estimation: simulates handleOps, filters failed operations
- Retry logic with gas scaling (150% on underpriced errors)
- Special features:
  - **Fastlane support**: MEV protection for v0.6 (Flashbots Protect)
  - **EIP-7702 support**: Delegation authorization lists
- Manages executor wallets via SenderManager (local or Redis-backed)

**5. ExecutorManager** (`src/executor/executorManager.ts`)
- Orchestrates bundling timing and operation lifecycle
- Three bundling modes:
  - **Auto**: Dynamic polling (100ms-1s) based on pending operations
  - **Manual**: Triggered via debug RPC methods
  - **Conditional**: Time-based triggers
- Monitors blockchain for UserOperationEvent emissions
- Handles failures: drops with reputation penalty or resubmits
- Detects frontrunning (operations included by other bundlers)

**6. Store** (`src/store/`)
- Three-tier storage: Outstanding, Processing, Submitted queues
- Two backends:
  - **Memory store**: In-process, fast, single instance
  - **Redis store**: Distributed state for horizontal scaling
- Per-EntryPoint isolation prevents cross-chain mixing

**7. Gas Price Manager** (`src/handlers/gasPriceManager.ts`)
- Chain-specific gas price handling (Arbitrum, Optimism, Mantle, Polygon)
- EIP-1559 and legacy transaction support
- Min/max queue tracking with configurable refresh intervals

### Data Flow: UserOperation Lifecycle

```
eth_sendUserOperation
  ↓
RpcHandler.addToMempoolIfValid()
  ├─ Pre-checks (nonce, gas limits)
  ├─ SafeValidator/UnsafeValidator.validate()
  └─ Reputation checks
  ↓
Mempool.add() → Outstanding queue
  ↓
ExecutorManager.autoScalingBundling()
  ├─ Mempool.getBundles()
  └─ Executor.bundle()
      ├─ Simulate handleOps
      ├─ Filter failed operations
      └─ Send transaction
  ↓
Mempool.markSubmitted() → Submitted queue
  ↓
ExecutorManager watches for UserOperationEvent
  ↓
Mempool.setUserOperationsStatus() → included/failed
```

### EntryPoint Version Support

Both v0.6 and v0.7 are supported with version-specific handling:

- **V0.6**: Combined `paymasterAndData` and `initCode` fields
- **V0.7**: Separated paymaster/factory/data fields, enhanced PostOp phase
- Version detection: Automatic based on UserOperation structure
- Separate ABIs, tracers, and gas estimators per version
- Standard addresses:
  - v0.6: `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`
  - v0.7: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

### Configuration

Configuration is managed via CLI flags or JSON config files:

```bash
./alto run --config config.json
```

Key config categories (see `src/cli/config/options.ts`):
- **Server**: RPC endpoint, port, CORS
- **Executor**: Private keys, gas limits, bundle mode (auto/manual)
- **Mempool**: Size limits, replacement rules, reputation thresholds
- **Validation**: Safe mode, simulation flags
- **Gas Estimation**: Multipliers, max verification gas
- **Network**: Chain ID, EntryPoint addresses, RPC URL

All configuration is centralized in `AltoConfig` (created in `src/createConfig.ts`), providing RPC clients, loggers, and typed access to all settings.

## Working with Contracts

Contracts are in `contracts/` directory using Foundry/Forge:

```bash
cd contracts
forge build                   # Compile contracts
forge test                    # Run contract tests
```

Contract ABIs are auto-generated as TypeScript types in `src/types/contracts/`.

Important contract dependencies (git submodules in `contracts/lib/`):
- `account-abstraction-v6`: EntryPoint v0.6 implementation
- `account-abstraction-v7`: EntryPoint v0.7 implementation
- `openzeppelin-contracts`: OpenZeppelin utilities
- `forge-std`: Foundry testing utilities

Update submodules: `git submodule update --init --recursive`

## Key Patterns and Conventions

### Monorepo Structure
- Workspaces: `src/`, `test/e2e/*`, `scripts/localDeployer`
- Each workspace has its own package.json
- Build commands run recursively across workspaces (`pnpm -r run build`)

### Dependency Injection
All major components receive dependencies via constructor (RPC client, logger, config, etc.). Makes testing and swapping implementations easy. See `src/cli/setupServer.ts` for orchestration.

### Version Agility
Shared interfaces for v0.6 and v0.7 with version-specific implementations where needed. A single Alto instance can serve multiple EntryPoints simultaneously.

### Event-Driven Architecture
EventManager emits lifecycle events (received, added, submitted, included, failed). Events can route to external systems via Redis queues for monitoring/debugging.

### Error Handling
- Validation errors: Return descriptive messages to RPC callers
- Execution errors: Retry with gas scaling or drop with reputation penalty
- Timeouts: Configurable per operation type

### Logging
Uses Pino logger (JSON-structured logs). Logger instances created per component with context metadata (entryPoint, sender, etc.). Set log level via `--log-level` flag.

## Common Development Scenarios

### Adding Support for a New RPC Method
1. Add method handler in `src/rpc/` (e.g., `customMethod.ts`)
2. Register in `src/rpc/rpcHandler.ts` method router
3. Add JSON-RPC schema validation using Zod in handler
4. Test via `curl` or RPC client

### Implementing Chain-Specific Logic
1. Add chain detection in `src/handlers/gasPriceManager.ts` or create new handler
2. Implement chain-specific gas calculation or RPC quirks
3. Update AltoConfig if new config options needed
4. Test with forked Anvil node: `./scripts/run-local-instance.sh -f -r <rpc-url> -b <block>`

### Debugging Validation Issues
1. Enable safe mode: `--safeMode true`
2. Increase log level: `--log-level debug`
3. Use `--environment development` to disable some checks
4. Check validation tracer output in logs (storage access, opcodes)
5. Compare against bundler-spec-tests: `pnpm test:spec`

### Testing Bundling Behavior
1. Start local environment: `cd test/e2e && docker-compose up`
2. Run Alto in manual mode: `--bundleMode manual`
3. Send operations via RPC: `eth_sendUserOperation`
4. Trigger bundle manually: `debug_bundler_sendBundleNow`
5. Check mempool state: `debug_bundler_dumpMempool`

### Horizontal Scaling Setup
1. Deploy Redis instance
2. Configure Alto with Redis URLs:
   - `--redisMempoolUrl redis://...`
   - `--redisSenderManagerUrl redis://...`
3. Start multiple Alto instances with same config
4. Operations distributed across instances via shared Redis state

## Important Files to Know

- `src/cli/setupServer.ts`: Main server setup, component orchestration
- `src/createConfig.ts`: Configuration factory, dependency setup
- `src/rpc/rpcHandler.ts`: RPC request routing and validation entry
- `src/mempool/mempool.ts`: Core mempool logic, bundle composition
- `src/executor/executor.ts`: Transaction submission and retry logic
- `src/executor/executorManager.ts`: Bundling orchestration
- `src/rpc/validation/SafeValidator.ts`: Spec-compliant validation with tracing
- `src/types/schemas.ts`: Zod schemas for UserOperation validation
- `src/types/interfaces.ts`: Core TypeScript interfaces

## Testing Notes

- E2E tests use vitest with prool (Anvil test utilities)
- Tests deploy deterministic EntryPoint addresses matching mainnet
- Spec tests validate ERC-4337 compliance against eth-infinitism test suite
- For spec tests, run Alto with `--environment development --bundleMode manual --safeMode true`
- Foundry must be installed for tests to work (contract compilation/deployment)
