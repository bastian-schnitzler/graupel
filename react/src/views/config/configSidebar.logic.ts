/**
 * Companion logic for ConfigSidebar component.
 */

/**
 * Validates and returns the target drop index for config reordering.
 * Returns null if the drop is invalid or a no-op.
 */
export function resolveConfigDropTarget(
  sourceIndex: number,
  targetIndex: number,
  totalConfigs: number,
): number | null {
  if (
    isNaN(sourceIndex) ||
    sourceIndex === targetIndex ||
    sourceIndex < 0 ||
    sourceIndex >= totalConfigs
  ) {
    return null;
  }
  return targetIndex;
}
