import { domAnimation } from "framer-motion";

// Loaded on demand by LazyMotion wrappers so framer-motion's animation
// runtime stays out of the initial bundle of every page that animates.
export default domAnimation;
