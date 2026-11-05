/** 唤醒探活所需的最小 gateway store 切片（便于单测注入）。 */
export type GatewayStoreSlice = {
  connState: string;
  autoReconnect: boolean;
  cancelReconnect: () => void;
  disconnect: () => void;
};
