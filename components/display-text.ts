/**
 * Keep stored interview evidence unchanged while avoiding typographic dash
 * flourishes in the rendered product UI.
 */
export function displayText(value: string): string {
  return value.replace(/[\u2013\u2014]/g, "-");
}
