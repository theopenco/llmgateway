"use client";

import { motion } from "framer-motion";

import type { Variants } from "framer-motion";

// Re-export motion components with proper client boundary
export { motion };
export type { Variants };

// Create wrapped motion components
export const MotionDiv = motion.div;
export const MotionSpan = motion.span;
export const MotionPath = motion.path;
export const MotionSvg = motion.svg;
