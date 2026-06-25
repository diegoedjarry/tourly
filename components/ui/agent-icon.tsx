import React from 'react';
import { Image } from 'react-native';

interface AgentIconProps {
  size?: number;
  color?: string;
  glow?: boolean;
}

const logo = require('@/assets/images/agent-logo.png');

export function AgentIcon({ size = 24 }: AgentIconProps) {
  return (
    <Image source={logo} style={{ width: size, height: size }} resizeMode="contain" />
  );
}
