declare module "bun:test" {
  interface AsymmetricAndLifecycleMatchers<T> extends jest.Matchers<void> {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toContain(expected: string): void;
    toHaveLength(expected: number): void;
    toBeInstanceOf(expected: abstract new (...args: never[]) => unknown): void;
    toThrow(expected?: string | RegExp | (abstract new (...args: never[]) => unknown)): void;
    readonly not: AsymmetricAndLifecycleMatchers<T>;
    readonly rejects: {
      toThrow(expected?: string | RegExp): Promise<void>;
      toBeInstanceOf(expected: abstract new (...args: never[]) => unknown): Promise<void>;
    };
  }

  export function expect<T>(actual: T): AsymmetricAndLifecycleMatchers<T>;
  export namespace expect {
    function extend(matchers: Record<string, (...args: never[]) => unknown>): void;
  }

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
}
