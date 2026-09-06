import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  PlatformColor,
} from "react-native";

interface LoadingScreenProps {
  message: string;
}

export default function LoadingScreen({ message }: LoadingScreenProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={PlatformColor("systemBlue")} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "white",
    padding: 20,
  },
  message: {
    marginTop: 20,
    fontSize: 16,
    color: "black",
    textAlign: "center",
    fontFamily: "System",
  },
});
