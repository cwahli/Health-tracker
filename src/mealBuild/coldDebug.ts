export const coldDebug = {} as any;
export const buildColdDebugPackage = (data: any) => {
  return { schemaVersion: 1, errors: [{}] };
};
export const coldDebugExpiredMessage = () => "expired in 14 days";
