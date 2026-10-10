/**
 * @format
 */

import { AppRegistry } from "react-native";

import App from "./App";
import { name as appName } from "./app.json";
import { applyAppearancePreference } from "./src/lib/appearance";

applyAppearancePreference();

AppRegistry.registerComponent(appName, () => App);
