export const shouldExpandMealAgent = (m: any) => {
  if (m?.dishCount >= 4) return true;
  if (m?.imageCount >= 3) return true;
  if (m?.hasReceipt || m?.hasBarcode) return true;
  return false;
};
