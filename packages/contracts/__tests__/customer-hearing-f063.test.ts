// Vitest — F-063 住環境・家族属性ヒアリングの純関数（docs/05 §17.5 / §17.7 / §17.8）.
//   1. maskFamilyAge（年代のみ）/ maskLandlinePhone / maskMobilePhone / maskExistingEquipmentForDealer
//   2. 既設設備の二次店向け物理除外（Object.keys に詳細キーが出ない／#5）
//   3. deriveCrossSellBadges の判定（有無ベース・MVP）

import { describe, expect, it } from "vitest";

import {
  maskExistingEquipmentForDealer,
  maskFamilyAge,
  maskLandlinePhone,
  maskMobilePhone,
  type ViewerContext,
} from "../src/services/masking.js";
import { deriveCrossSellBadges } from "../src/services/cross-sell.js";
import {
  DEALER_OMITTED_EXISTING_EQUIPMENT_KEYS,
  stripExistingEquipmentForDealer,
  toProjectInfoDealerDto,
  type ExistingEquipmentDto,
  type ProjectInfoDto,
} from "../src/dto/project-info.js";

const fullViewer: ViewerContext = {
  role: "WHOLESALER_ADMIN",
  tenantType: "WHOLESALER",
  isSelfTenant: true,
  piiMaskingMode: "FULL",
};
const dealerViewer: ViewerContext = {
  role: "DEALER_ADMIN",
  tenantType: "DEALER",
  isSelfTenant: true,
  piiMaskingMode: "MASKED",
};
// 下4桁露出（PARTIAL）の検証用。DEALER で isSelfTenant の場合 piiMaskingMode を尊重する。
const dealerPartialViewer: ViewerContext = {
  role: "DEALER_ADMIN",
  tenantType: "DEALER",
  isSelfTenant: true,
  piiMaskingMode: "PARTIAL",
};

describe("maskFamilyAge — 家族年齢は年代のみ（§17.5）", () => {
  it("FULL 閲覧者は具体値（NN歳）", () => {
    expect(maskFamilyAge(45, fullViewer)).toBe("45歳");
  });
  it("二次店（MASKED）は年代のみ", () => {
    expect(maskFamilyAge(45, dealerViewer)).toBe("40代");
    expect(maskFamilyAge(8, dealerViewer)).toBe("0代");
  });
  it("null / 範囲外は未設定", () => {
    expect(maskFamilyAge(null, fullViewer)).toBe("未設定");
    expect(maskFamilyAge(undefined, dealerViewer)).toBe("未設定");
    expect(maskFamilyAge(200, fullViewer)).toBe("未設定");
  });
});

describe("maskLandlinePhone / maskMobilePhone — 下4桁（§17.5）", () => {
  it("FULL は素通し", () => {
    expect(maskLandlinePhone("03-1234-5678", fullViewer)).toBe("03-1234-5678");
    expect(maskMobilePhone("090-1234-5678", fullViewer)).toBe("090-1234-5678");
  });
  it("二次店（PARTIAL）は下4桁のみ露出", () => {
    expect(maskMobilePhone("090-1234-5678", dealerPartialViewer)).toBe("***-****-5678");
  });
  it("二次店（MASKED）は全桁マスク", () => {
    expect(maskMobilePhone("090-1234-5678", dealerViewer)).toBe("***-****-****");
  });
  it("null / 空は未設定", () => {
    expect(maskLandlinePhone(null, fullViewer)).toBe("未設定");
    expect(maskMobilePhone("", dealerViewer)).toBe("未設定");
  });
});

function baseEquipment(over: Partial<ExistingEquipmentDto> = {}): ExistingEquipmentDto {
  return {
    id: "ee1",
    category: "PV",
    installed: "YES",
    installDate: "2020-01-01T00:00:00.000Z",
    maker: "長州産業",
    capacityKw: 4.5,
    panelCount: 12,
    attributes: { model: "CS-400MB" },
    ...over,
  };
}

describe("maskExistingEquipmentForDealer / 物理除外（§17.5・#5）", () => {
  it("二次店向けは category + installed のみへ縮約", () => {
    const reduced = maskExistingEquipmentForDealer(baseEquipment());
    expect(reduced).toEqual({ category: "PV", installed: "YES" });
  });

  it("stripExistingEquipmentForDealer は詳細キーを Object.keys に出さない", () => {
    const stripped = stripExistingEquipmentForDealer(baseEquipment());
    const keys = Object.keys(stripped);
    for (const omitted of DEALER_OMITTED_EXISTING_EQUIPMENT_KEYS) {
      expect(keys).not.toContain(omitted);
    }
    expect(keys).toEqual(expect.arrayContaining(["id", "category", "installed"]));
  });
});

describe("deriveCrossSellBadges — 有無ベース判定（§17.8）", () => {
  it("ガス給湯器 YES → エコキュート提案", () => {
    expect(deriveCrossSellBadges([baseEquipment({ category: "GAS_WATER_HEATER" })])).toEqual([
      "ECO_CUTE_SUGGEST",
    ]);
  });
  it("エコキュート YES → 蓄電池提案", () => {
    expect(deriveCrossSellBadges([baseEquipment({ category: "ECO_CUTE" })])).toEqual([
      "BATTERY_SUGGEST",
    ]);
  });
  it("PV YES → 蓄電池提案 + 太陽光増設提案", () => {
    expect(deriveCrossSellBadges([baseEquipment({ category: "PV" })])).toEqual([
      "BATTERY_SUGGEST",
      "PV_EXPAND_SUGGEST",
    ]);
  });
  it("installed が YES でない行はバッジを生まない", () => {
    expect(
      deriveCrossSellBadges([
        baseEquipment({ category: "GAS_WATER_HEATER", installed: "NO" }),
        baseEquipment({ category: "ECO_CUTE", installed: "UNKNOWN" }),
      ]),
    ).toEqual([]);
  });
  it("複数カテゴリでも de-dup・安定順序（ECO_CUTE→BATTERY→PV_EXPAND）", () => {
    expect(
      deriveCrossSellBadges([
        baseEquipment({ category: "PV" }),
        baseEquipment({ category: "ECO_CUTE" }),
        baseEquipment({ category: "GAS_WATER_HEATER" }),
      ]),
    ).toEqual(["ECO_CUTE_SUGGEST", "BATTERY_SUGGEST", "PV_EXPAND_SUGGEST"]);
  });
});

describe("toProjectInfoDealerDto — hearing.existingEquipments の物理除外（#5）", () => {
  function dtoWithHearing(): ProjectInfoDto {
    return {
      basic: {
        customerId: "c1",
        name: "山田",
        kana: null,
        birthDate: "40代",
        age: null,
        postalCode: null,
        address: "東京都新宿区",
        phone: "***-****-5678",
        email: null,
        buildYear: null,
      },
      organization: {
        tossUpUserName: null,
        closingUserName: null,
        tossDept: null,
        belongDept: null,
      },
      contracts: [],
      constructions: [],
      applications: [],
      activities: [],
      note: null,
      overview: {
        electricBill: null,
        household: null,
        housingType: null,
        inflowRoute: null,
        maekakuStatus: null,
      },
      financials: {
        contractAmount: null,
        proposedAmount: null,
        incentiveGrossProfit: null,
        incentiveAmount: null,
        purchaseTotal: 1,
        dealerTotal: 1,
        constructionFee: 1,
        otherCost: 1,
      },
      hearing: {
        husbandAge: "40代",
        wifeAge: "30代",
        childAge: "未設定",
        household: "4人家族",
        guideAttendee: "BOTH",
        faceToFace: true,
        proposedProduct: "太陽光 + 蓄電池",
        landlinePhone: "***-****-5678",
        mobilePhone: "***-****-1234",
        maekakuPreferredAt: null,
        acquiredAt: null,
        existingEquipments: [baseEquipment()],
      },
    };
  }

  it("二次店 DTO の既設設備から詳細キーが消え、JSON にも出ない", () => {
    const dealer = toProjectInfoDealerDto(dtoWithHearing());
    for (const eq of dealer.hearing.existingEquipments) {
      const keys = Object.keys(eq);
      for (const omitted of DEALER_OMITTED_EXISTING_EQUIPMENT_KEYS) {
        expect(keys).not.toContain(omitted);
      }
    }
    const json = JSON.stringify(dealer.hearing);
    expect(json).not.toContain("capacityKw");
    expect(json).not.toContain("panelCount");
    expect(json).not.toMatch(/"maker":/);
    expect(json).not.toMatch(/"installDate":/);
  });
});
