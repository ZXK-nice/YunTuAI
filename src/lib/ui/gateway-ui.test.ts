import { describe, expect, it } from "vitest";
import { humanizeGatewayConn, humanizeGatewayConnShort } from "./gateway-ui";

describe("humanizeGatewayConn", () => {
  it("gives long labels for header hover / tooltips", () => {
    expect(humanizeGatewayConn("connected")).toBe("服务已连接");
  });
});

describe("humanizeGatewayConnShort", () => {
  it("matches connection state with compact UI copy", () => {
    expect(humanizeGatewayConnShort("connected")).toBe("已连接");
    expect(humanizeGatewayConnShort("connecting")).toBe("连接中");
    expect(humanizeGatewayConnShort("error")).toBe("异常");
    expect(humanizeGatewayConnShort("disconnected")).toBe("未连接");
  });
});
