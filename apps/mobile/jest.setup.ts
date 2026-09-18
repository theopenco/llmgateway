jest.mock("react-native/Libraries/Settings/NativeSettingsManager", () => ({
	getConstants: () => ({ settings: {} }),
	setValues: jest.fn(),
	deleteValues: jest.fn(),
}));
