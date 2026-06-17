import { getAppEnv, isMockEnabled } from './app-env';

describe('getAppEnv', () => {
  let savedAppEnv: string | undefined;

  beforeEach(() => {
    savedAppEnv = process.env.APP_ENV;
  });

  afterEach(() => {
    if (savedAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = savedAppEnv;
    }
  });

  it('returns "production" when APP_ENV is absent', () => {
    delete process.env.APP_ENV;
    expect(getAppEnv()).toBe('production');
  });

  it('returns "production" when APP_ENV is explicitly "production"', () => {
    process.env.APP_ENV = 'production';
    expect(getAppEnv()).toBe('production');
  });

  it('returns "development" when APP_ENV is "development"', () => {
    process.env.APP_ENV = 'development';
    expect(getAppEnv()).toBe('development');
  });

  it('returns "demo" when APP_ENV is "demo"', () => {
    process.env.APP_ENV = 'demo';
    expect(getAppEnv()).toBe('demo');
  });

  it('returns "production" for any unknown value', () => {
    process.env.APP_ENV = 'qualquer_coisa';
    expect(getAppEnv()).toBe('production');
  });
});

describe('isMockEnabled', () => {
  let savedAppEnv: string | undefined;

  beforeEach(() => {
    savedAppEnv = process.env.APP_ENV;
  });

  afterEach(() => {
    if (savedAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = savedAppEnv;
    }
  });

  it('is false when APP_ENV is absent', () => {
    delete process.env.APP_ENV;
    expect(isMockEnabled()).toBe(false);
  });

  it('is false when APP_ENV is "production"', () => {
    process.env.APP_ENV = 'production';
    expect(isMockEnabled()).toBe(false);
  });

  it('is true when APP_ENV is "development"', () => {
    process.env.APP_ENV = 'development';
    expect(isMockEnabled()).toBe(true);
  });

  it('is true when APP_ENV is "demo"', () => {
    process.env.APP_ENV = 'demo';
    expect(isMockEnabled()).toBe(true);
  });
});
