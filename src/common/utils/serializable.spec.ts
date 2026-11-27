import { ConflictException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { runSerializable } from "./serializable";

/** Minimal stand-in for the pieces of PrismaClient the helper touches. */
function fakePrisma(behaviours: (() => unknown)[]) {
  let call = 0;
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const behaviour = behaviours[Math.min(call, behaviours.length - 1)];
    call += 1;
    const outcome = behaviour();
    if (outcome instanceof Error) {
      throw outcome;
    }
    return fn({});
  });

  return {
    prisma: { $transaction: transaction } as unknown as PrismaClient,
    transaction,
    get attempts() {
      return call;
    },
  };
}

function writeConflict(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
    { code: "P2034", clientVersion: "6.0.0" },
  );
}

describe("runSerializable", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns the result on the first attempt when there is no conflict", async () => {
    const fake = fakePrisma([() => null]);
    const work = jest.fn(async () => "ok");

    const result = await runSerializable(fake.prisma, work);

    expect(result).toBe("ok");
    expect(work).toHaveBeenCalledTimes(1);
    expect(fake.transaction).toHaveBeenCalledTimes(1);
  });

  it("retries a P2034 write conflict and then succeeds", async () => {
    const fake = fakePrisma([() => writeConflict(), () => null]);
    const work = jest.fn(async () => "recovered");

    const promise = runSerializable(fake.prisma, work);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toBe("recovered");
    expect(fake.transaction).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-conflict error", async () => {
    const boom = new Error("column does not exist");
    const fake = fakePrisma([() => boom]);
    const work = jest.fn(async () => "never");

    await expect(runSerializable(fake.prisma, work)).rejects.toBe(boom);
    expect(fake.transaction).toHaveBeenCalledTimes(1);
  });

  it("answers 409 instead of 500 when every attempt loses the race", async () => {
    const fake = fakePrisma([() => writeConflict()]);
    const work = jest.fn(async () => "never");

    const promise = runSerializable(fake.prisma, work);
    const assertion = expect(promise).rejects.toBeInstanceOf(ConflictException);
    await jest.runAllTimersAsync();
    await assertion;

    expect(fake.transaction).toHaveBeenCalledTimes(5);
    expect(work).not.toHaveBeenCalled();
  });

  it("treats a deadlock reported by the driver as retryable", async () => {
    const deadlock = Object.assign(new Error("deadlock detected"), {
      code: "40P01",
    });
    const fake = fakePrisma([() => deadlock, () => null]);

    const promise = runSerializable(fake.prisma, async () => "ok");
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fake.transaction).toHaveBeenCalledTimes(2);
  });
});
