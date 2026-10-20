import { domAnimation } from "framer-motion";

// Loaded on demand by Newsletter's LazyMotion so framer-motion's animation
// runtime stays out of the initial bundle of every page with a footer.
export default domAnimation;
