/**
 * Sanitizes and formats database save error messages for header display.
 */
export function getDisplaySaveError(err: string | null): string {
  if (!err) return "Could not save configuration";
  const firstLine = err.split("\n")[0].trim();
  const sanitized =
    firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  if (
    sanitized.toLowerCase().includes("could not save") ||
    sanitized.toLowerCase().includes("failed") ||
    sanitized.toLowerCase().includes("error")
  ) {
    return sanitized;
  }
  return `Could not save configuration: ${sanitized}`;
}
