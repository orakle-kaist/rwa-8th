export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class AdjustableClock implements Clock {
  readonly #initial: Date;
  #offsetMilliseconds = 0;

  constructor(initial: Date) {
    if (Number.isNaN(initial.valueOf())) {
      throw new Error("가상시계의 초기시각이 올바르지 않다.");
    }
    this.#initial = new Date(initial);
  }

  now(): Date {
    return new Date(this.#initial.valueOf() + this.#offsetMilliseconds);
  }

  advance(milliseconds: number): Date {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new Error("가상시계는 0 이상의 정수 밀리초만 이동할 수 있다.");
    }
    this.#offsetMilliseconds += milliseconds;
    return this.now();
  }
}

export function createClock(environment: NodeJS.ProcessEnv): Clock {
  if (environment.TEST_CLOCK_MODE !== "fixed") {
    return new SystemClock();
  }

  const initial = environment.TEST_CLOCK_ISO;
  if (!initial) {
    throw new Error("고정 가상시계를 사용하려면 TEST_CLOCK_ISO가 필요하다.");
  }
  return new AdjustableClock(new Date(initial));
}
