// Inline the Flywheel Extension SDK (loading it from cdn.flywheel.io fails on GitHub Pages; see reader-study-dashboard notes).
import * as Flywheel from '@flywheel-io/extension';
window.Flywheel = Flywheel;
