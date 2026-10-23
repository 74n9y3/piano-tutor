const FILENAME_MOVEMENT =
  /<movement-title>\s*[^<]*?\.(?:musicxml|xml|mid|midi)\s*<\/movement-title>/gi;

/** OSMD draws movement-title under the work title. A filename is not a subtitle. */
export function stripFilenameMovementTitle(xml: string): string {
  return xml.replace(FILENAME_MOVEMENT, "");
}
