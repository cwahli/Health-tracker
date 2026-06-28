export const getCurrentDateInTimezone = (timezone?: string): string => {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    // output format: YYYY-MM-DD
    return formatter.format(new Date());
  } catch (e) {
    console.error("Invalid timezone:", tz, e);
    return new Date().toISOString().split('T')[0];
  }
};
