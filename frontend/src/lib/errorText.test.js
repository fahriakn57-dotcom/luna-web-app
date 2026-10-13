/* global describe, test, expect */
// lib/errorText.js — run with:  CI=true npx craco test --watchAll=false src/lib/errorText
import { serverDetail } from "./errorText";

const err = (status, detail) => ({ response: { status, data: { detail } } });

describe("serverDetail", () => {
  test("the server's sentence for 403 / 413 / 422 / 429", () => {
    expect(serverDetail(err(403, "Görsel üretimi bir süreliğine durduruldu."))).toBe("Görsel üretimi bir süreliğine durduruldu.");
    expect(serverDetail(err(413, "Mesaj çok uzun (en fazla 4.000 karakter)."))).toBe("Mesaj çok uzun (en fazla 4.000 karakter).");
    expect(serverDetail(err(422, "Bu isteği bu haliyle yapamıyorum."))).toBe("Bu isteği bu haliyle yapamıyorum.");
    expect(serverDetail(err(429, "Günlük mesaj sınırına ulaştın."))).toBe("Günlük mesaj sınırına ulaştın.");
  });

  test("other statuses only when asked for", () => {
    expect(serverDetail(err(502, "Bu görseli oluşturamıyorum, içerik kurallarına takılıyor."))).toBeNull();
    expect(serverDetail(err(502, "Bu görseli oluşturamıyorum, içerik kurallarına takılıyor."), [403, 502])).toBe(
      "Bu görseli oluşturamıyorum, içerik kurallarına takılıyor.");
  });

  test("never a machine code, a validation list, markup or nothing", () => {
    expect(serverDetail(err(413, "internal_error"))).toBeNull();
    expect(serverDetail(err(422, [{ loc: ["body", "text"], msg: "field required" }]))).toBeNull();
    expect(serverDetail(err(403, "<html><body>403</body></html>"))).toBeNull();
    expect(serverDetail(err(403, "   "))).toBeNull();
    expect(serverDetail(err(403, "x".repeat(401)))).toBeNull();
    expect(serverDetail({ response: { status: 403, data: "<html>" } })).toBeNull();
    expect(serverDetail(new Error("Network Error"))).toBeNull();
    expect(serverDetail(null)).toBeNull();
  });
});
