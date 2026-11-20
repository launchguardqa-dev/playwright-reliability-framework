import * as dotenv from 'dotenv';
dotenv.config();

export const USERS = {
  STANDARD: {
    username: process.env.STANDARD_USER ?? 'standard_user',
    password: process.env.TEST_PASSWORD ?? 'secret_sauce',
  },
  LOCKED: {
    username: process.env.LOCKED_USER ?? 'locked_out_user',
    password: process.env.TEST_PASSWORD ?? 'secret_sauce',
  },
  INVALID: {
    username: 'invalid_user',
    password: 'wrong_password',
  },

  /*
   * SauceDemo's deliberately broken accounts. They log in normally,
   * then the app misbehaves. See tests/users/user-variants.spec.ts.
   */
  PROBLEM: {
    username: 'problem_user',
    password: process.env.TEST_PASSWORD ?? 'secret_sauce',
  },
  ERROR: {
    username: 'error_user',
    password: process.env.TEST_PASSWORD ?? 'secret_sauce',
  },
  PERFORMANCE_GLITCH: {
    username: 'performance_glitch_user',
    password: process.env.TEST_PASSWORD ?? 'secret_sauce',
  },
  VISUAL: {
    username: 'visual_user',
    password: process.env.TEST_PASSWORD ?? 'secret_sauce',
  },
} as const;

export const ERROR_MESSAGES = {
  LOCKED_USER: 'Epic sadface: Sorry, this user has been locked out.',
  INVALID_CREDENTIALS: 'Epic sadface: Username and password do not match any user in this service',
  MISSING_USERNAME: 'Epic sadface: Username is required',
  MISSING_PASSWORD: 'Epic sadface: Password is required',
} as const;
