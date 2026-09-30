// @idp/surface/testing — functional-test harness: the mock-bank process, a shared browser, and a simulated
// person. Never imported by production code.
export { launchMockBank, type FaultOptions, type MockBank, type MockBankOptions } from './launchMockBank.js';
export { MockBankStartError } from './MockBankStartError.js';
export { launchBrowserFixture, type BrowserFixture } from './browserFixture.js';
export { SimulatedOperator, type OperatorTarget } from './SimulatedOperator.js';
export { FakeSurface, fakeFingerprint, fakeLocation, fakeObservation, type FakeSurfaceOptions } from './FakeSurface.js';
export { mockBankPolicyConfig } from './mockBankPolicyConfig.js';
