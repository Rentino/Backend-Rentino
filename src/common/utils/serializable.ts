import { ConflictException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

export type TransactionClient = Prisma.TransactionClient;

/** Attempts include the first try, so 5 means "the original + 4 retries". */
const MAX_ATTEMPTS = 5;

/** Exponential backoff base — 25ms, 50ms, 100ms, 200ms between retries. */
const BASE_DELAY_MS = 25;

/**
 * True when Postgres aborted the transaction because it lost a write race
 * rather than because the operation itself was invalid. Those are the only
 * errors worth replaying: the work was correct, the timing was not.
 */
function isRetryableConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: "Transaction failed due to a write conflict or a deadlock."
    return error.code === "P2034";
  }

  // A deadlock surfaced by the driver rather than Prisma's typed error.
  const candidate = error as { code?: string; message?: string };
  if (candidate?.code === "40P01" || candidate?.code === "40001") {
    return true;
  }

  const message =
    typeof candidate?.message === "string" ? candidate.message : "";
  return (
    message.includes("write conflict") ||
    message.includes("deadlock detected") ||
    message.includes("could not serialize access")
  );
}

function backoffDelay(attempt: number): number {
  // Jitter keeps retrying writers from colliding again in lockstep.
  const base = BASE_DELAY_MS * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * BASE_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` inside a SERIALIZABLE transaction, retrying with backoff on
 * Postgres serialization failures (Prisma `P2034`, deadlocks, 40001).
 *
 * Used by booking, payment and review flows where concurrent writers must not
 * interleave. If every attempt loses its race the caller gets a `409` — the
 * request was valid, it just needs to be retried — never a `500`.
 */
export async function runSerializable<T>(
  prisma: PrismaClient,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableConflict(error)) {
        throw error;
      }

      if (attempt === MAX_ATTEMPTS) {
        throw new ConflictException(
          "درخواست شما با یک عملیات هم‌زمان برخورد کرد؛ لطفاً دوباره تلاش کنید",
        );
      }

      await sleep(backoffDelay(attempt));
    }
  }

  // Unreachable: the loop either returns or throws on its final attempt.
  throw new ConflictException(
    "درخواست شما با یک عملیات هم‌زمان برخورد کرد؛ لطفاً دوباره تلاش کنید",
  );
}
