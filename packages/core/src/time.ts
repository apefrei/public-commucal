/** All tenants operate in Swiss local time (requirements FR-11). */
export const TENANT_TIME_ZONE = "Europe/Zurich";

/**
 * Converts a local wall-clock date and time in the tenant time zone to an exact instant.
 *
 * During the spring DST gap (e.g. 02:30 on the last Sunday of March) the time does not exist;
 * "compatible" moves it forward by the length of the gap, as calendar clients do.
 * During the autumn overlap the earlier of the two instants is chosen.
 */
export function wallClockToInstant(
  dateTime: Temporal.PlainDateTime,
  timeZone: string = TENANT_TIME_ZONE,
): Temporal.Instant {
  return dateTime.toZonedDateTime(timeZone, { disambiguation: "compatible" }).toInstant();
}

/** Formats an instant as ISO 8601 with the offset that applies in the tenant time zone. */
export function toTenantIsoString(
  instant: Temporal.Instant,
  timeZone: string = TENANT_TIME_ZONE,
): string {
  return instant.toZonedDateTimeISO(timeZone).toString({ timeZoneName: "never" });
}
