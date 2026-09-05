import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BurningMapsDemo } from "./src/burning-maps/BurningMapsDemo";

const burningMapsDemo = process.env.EXPO_PUBLIC_BURNING_MAPS_DEMO !== "false";

export default function App() {
  if (burningMapsDemo) {
    return (
      <SafeAreaProvider>
        <BurningMapsDemo />
      </SafeAreaProvider>
    );
  }

  const TurtleMapsApp = require("./TurtleMapsApp").default as React.ComponentType;
  return <TurtleMapsApp />;
}
