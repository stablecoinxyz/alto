// biome-ignore lint/nursery/noNodejsModules: the test must construct the same CJS error class as the compiled client
import { createRequire } from "node:module"
import { entryPoint07Address } from "viem/account-abstraction"
import { describe, expect, test, vi } from "vitest"
// biome-ignore lint/nursery/useImportRestrictions: the test exercises the compiled ExecutorManager boundary directly
import { ExecutorManager } from "../../../src/lib/executor/index.js"

const { TransactionReceiptNotFoundError } = createRequire(import.meta.url)(
    "../../../src/node_modules/viem"
)

const userOperationHash =
    "0x43499fc593653ed655962004f8cb216108c239c17858a692d0ef5c3b61d9f73e"
const transactionHash =
    "0x7c60f41fb770092a390a7ca46a5811827abe5105592fb86509da9addbcaaa9d1"

function createExecutorManager({
    status,
    receiptError,
    receipt
}: {
    status: () => Promise<unknown>
    receiptError?: Error
    receipt?: { logs: never[]; effectiveGasPrice: bigint }
}) {
    const publicClient = {
        getBlockNumber: vi.fn().mockResolvedValue(20_000n),
        getLogs: vi.fn().mockResolvedValue([]),
        getTransactionReceipt: receipt
            ? vi.fn().mockResolvedValue(receipt)
            : vi
                  .fn()
                  .mockRejectedValue(
                      receiptError ?? new Error("No receipt fixture")
                  )
    }
    const monitor = {
        getUserOperationStatus: vi.fn().mockImplementation(status)
    }
    const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
    const config = {
        bundleMode: "manual",
        entrypoints: [entryPoint07Address],
        maxBlockRange: 10_000,
        publicClient,
        getLogger: () => logger
    }

    const manager = new ExecutorManager({
        config,
        executor: {},
        mempool: {},
        monitor,
        reputationManager: {},
        metrics: {},
        gasPriceManager: {},
        eventManager: {},
        senderManager: {}
    } as unknown as ConstructorParameters<typeof ExecutorManager>[0])

    return { manager, publicClient }
}

describe("ExecutorManager.getUserOperationReceipt", () => {
    test("falls back to logs when monitor status lookup fails", async () => {
        const { manager, publicClient } = createExecutorManager({
            status: () => Promise.reject(new Error("Redis unavailable"))
        })

        await expect(
            manager.getUserOperationReceipt(userOperationHash)
        ).resolves.toBeNull()

        expect(publicClient.getLogs).toHaveBeenCalledOnce()
    })

    test("falls back to logs after a bounded stale-hash receipt lookup", async () => {
        const { manager, publicClient } = createExecutorManager({
            status: () =>
                Promise.resolve({ status: "included", transactionHash }),
            receiptError: new TransactionReceiptNotFoundError({
                hash: transactionHash
            })
        })

        await expect(
            manager.getUserOperationReceipt(userOperationHash)
        ).resolves.toBeNull()

        expect(publicClient.getTransactionReceipt).toHaveBeenCalledTimes(3)
        expect(publicClient.getLogs).toHaveBeenCalledOnce()
    })

    test("uses log discovery for an untracked operation", async () => {
        const { manager, publicClient } = createExecutorManager({
            status: () =>
                Promise.resolve({ status: "not_found", transactionHash: null })
        })

        await expect(
            manager.getUserOperationReceipt(userOperationHash)
        ).resolves.toBeNull()

        expect(publicClient.getTransactionReceipt).not.toHaveBeenCalled()
        expect(publicClient.getLogs).toHaveBeenCalledOnce()
    })

    test("falls back to logs when the included receipt has no matching event", async () => {
        const { manager, publicClient } = createExecutorManager({
            status: () =>
                Promise.resolve({ status: "included", transactionHash }),
            receipt: { logs: [], effectiveGasPrice: 1n }
        })

        await expect(
            manager.getUserOperationReceipt(userOperationHash)
        ).resolves.toBeNull()

        expect(publicClient.getTransactionReceipt).toHaveBeenCalledOnce()
        expect(publicClient.getLogs).toHaveBeenCalledOnce()
    })
})
