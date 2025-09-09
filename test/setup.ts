// Jest setup file for BigInt support and other test utilities
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeCloseToNumber(expected: number, precision?: number): R;
    }
  }
}

export {}; 