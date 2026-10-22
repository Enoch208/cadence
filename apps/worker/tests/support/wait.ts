export async function until(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!(await check())) {
    if (performance.now() > deadline) {
      throw new Error(`The condition did not hold within ${String(timeoutMs)} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
