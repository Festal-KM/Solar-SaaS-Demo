// Vitest — F-061 ProjectInfoDto の純関数（docs/05 §16.9 / §16.10）.
//   1. 二次店向け物理除外（Object.keys に原価系キーが出ない／#5）
//   2. pickRepresentativeConstruction の選定ルール（§16.2 カテゴリ 5）
//   3. maskBirthDate（年代のみ）/ computeAge

import { describe, expect, it } from "vitest";

import {
  computeAge,
  maskBirthDate,
  type ViewerContext,
} from "../src/services/masking.js";
import {
  DEALER_OMITTED_FINANCIAL_KEYS,
  emptyEquipmentByCategory,
  pickRepresentativeConstruction,
  toProjectInfoDealerDto,
  toProjectInfoWholesalerDto,
  type EquipmentItemDto,
  type ProjectInfoDto,
} from "../src/dto/project-info.js";

function baseEquipmentItem(over: Partial<EquipmentItemDto> = {}): EquipmentItemDto {
  return {
    id: "eq1",
    contracted: true,
    amount: null,
    manufacturer: null,
    model: null,
    capacity: null,
    quantity: null,
    installLocation: null,
    introducedStatus: null,
    warrantyStandard: null,
    warrantyExtended: null,
    warrantyDisaster: null,
    detail: null,
    attributes: null,
    snapshotPurchasePrice: 123456,
    ...over,
  };
}

function baseDto(): ProjectInfoDto {
  const equipment = emptyEquipmentByCategory();
  equipment.PV.push(baseEquipmentItem());
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
    contracts: [
      {
        contractId: "ct1",
        contractDate: null,
        docsUrl: null,
        proposedAmount: 3000000,
        contractAmount: 3500000,
        paymentCount: 60,
        paymentStatus: "PARTIAL",
        depositDate: null,
        dealerPayoutDate: null,
        loanReviewCallAt: null,
        loanCompany: null,
        downPayment: 100000,
        creditLifeInsurance: true,
        loanNote: null,
        callStatus: "DONE",
        equipmentSerialId: null,
        representativeConstructionId: "con2",
        equipment,
      },
    ],
    loanReviews: [
      {
        loanReviewId: "lr1",
        status: "reviewing",
        loanCompany: "ジャックス",
        downPayment: 100000,
        creditLifeInsurance: true,
        note: null,
        defectContent: null,
        defectStatus: "none",
        reviewedAt: null,
        logs: [
          { id: "lrl1", reviewedAt: "2026-06-01T00:00:00.000Z", result: "approved", note: null, handlerName: "佐藤" },
        ],
      },
    ],
    constructions: [
      {
        constructionId: "con1",
        contractId: "ct1",
        surveyDate: null,
        plannedDate: null,
        surveyCandidates: null,
        constructionCandidates: null,
        startedDate: null,
        completedDate: null,
        powerSaleStartDate: null,
        status: "DONE",
        surveyStatus: "surveyed",
        postCompletionStatus: "DONE",
        defectStatus: "NONE",
        defectDetail: null,
        vendorName: null,
        thankYouCallAt: null,
        fee: 200000,
      },
    ],
    applications: [],
    activities: [],
    note: null,
    specialNote: "特記: 旧型パワコン交換要相談",
    overview: {
      electricBill: null,
      household: null,
      housingType: null,
      inflowRoute: null,
      maekakuStatus: null,
    },
    financials: {
      contractAmount: 3500000,
      proposedAmount: 3000000,
      incentiveGrossProfit: 400000,
      incentiveAmount: 80000,
      purchaseTotal: 2000000,
      dealerTotal: 2500000,
      constructionFee: 200000,
      otherCost: 50000,
      constructionFeeBreakdown: { labor: 100000 },
    },
    profitAndLoss: [
      {
        contractId: "ct1",
        contractLabel: "契約 #1",
        salesPrice: 3500000,
        constructionFeeTotal: 200000,
        venueFeeTotal: 50000,
        grossProfit: 3250000,
        commissionRatePercent: 10,
        commission: 325000,
        costItems: [],
        constructions: [],
      },
    ],
    hearing: {
      husbandAge: "40代",
      wifeAge: "30代",
      childAge: "未設定",
      household: null,
      guideAttendee: null,
      faceToFace: null,
      proposedProduct: null,
      landlinePhone: "未設定",
      mobilePhone: "未設定",
      maekakuPreferredAt: null,
      acquiredAt: null,
      existingEquipments: [],
    },
    calls: {
      landlinePhone: "未設定",
      mobilePhone: "未設定",
      maekakuStatus: null,
      maekakuPreferredAt: null,
      maekakuCallNote: null,
      nextAppointmentAt: null,
      nextAppointmentAssigneeName: null,
      nextAction: null,
      callLogs: [],
      thankYouCallStatus: null,
      thankYouCallPreferredAt: null,
      thankYouCallNote: null,
      loanCompletionCallStatus: null,
      loanCompletionCallPreferredAt: null,
      loanCompletionCallNote: null,
      postCompletionCallStatus: null,
      postCompletionCallPreferredAt: null,
      postCompletionCallNote: null,
      generalCallPreferredTime: null,
    },
  };
}

describe("toProjectInfoDealerDto — 仕入値・原価の物理除外（#5）", () => {
  it("financials から原価系キーが Object.keys に一切出ない", () => {
    const dealer = toProjectInfoDealerDto(baseDto());
    const keys = Object.keys(dealer.financials);
    for (const omitted of DEALER_OMITTED_FINANCIAL_KEYS) {
      expect(keys).not.toContain(omitted);
    }
    // 表示可能な金額は残る。
    expect(keys).toEqual(
      expect.arrayContaining([
        "contractAmount",
        "proposedAmount",
        "incentiveGrossProfit",
        "incentiveAmount",
      ]),
    );
  });

  it("各 construction から fee キーが消える", () => {
    const dealer = toProjectInfoDealerDto(baseDto());
    for (const con of dealer.constructions) {
      expect(Object.keys(con)).not.toContain("fee");
    }
  });

  it("各設備明細から snapshotPurchasePrice キーが消える", () => {
    const dealer = toProjectInfoDealerDto(baseDto());
    for (const c of dealer.contracts) {
      for (const item of c.equipment.PV) {
        expect(Object.keys(item)).not.toContain("snapshotPurchasePrice");
      }
    }
  });

  it("特記事項（specialNote）は二次店 DTO にもそのまま残る（原価でも PII でもない）", () => {
    const dealer = toProjectInfoDealerDto(baseDto());
    expect(dealer.specialNote).toBe("特記: 旧型パワコン交換要相談");
    expect(Object.keys(dealer)).toContain("specialNote");
  });

  it("損益計算（profitAndLoss）セクションが丸ごと物理除外される（#4・#5）", () => {
    const dealer = toProjectInfoDealerDto(baseDto());
    expect(Object.keys(dealer)).not.toContain("profitAndLoss");
    expect("profitAndLoss" in dealer).toBe(false);
  });

  it("ローン審査（loanReviews）は二次店 DTO にもそのまま残る（原価でも PII でもない）", () => {
    const dealer = toProjectInfoDealerDto(baseDto());
    expect(Object.keys(dealer)).toContain("loanReviews");
    expect(dealer.loanReviews).toHaveLength(1);
    expect(dealer.loanReviews[0]!.loanCompany).toBe("ジャックス");
    expect(dealer.loanReviews[0]!.logs[0]!.result).toBe("approved");
  });

  it("JSON シリアライズ後にも原価キー名が出現しない", () => {
    const json = JSON.stringify(toProjectInfoDealerDto(baseDto()));
    expect(json).not.toContain("snapshotPurchasePrice");
    expect(json).not.toContain("purchaseTotal");
    expect(json).not.toContain("dealerTotal");
    expect(json).not.toContain("constructionFeeBreakdown");
    expect(json).not.toContain("otherCost");
    // construction の fee キーも出ない（"feeXxx" のような別キーは無いので素直に判定）。
    expect(json).not.toMatch(/"fee":/);
    // 損益計算の機密キー（売上・粗利・粗利率）も二次店 JSON に出ない。
    expect(json).not.toContain("profitAndLoss");
    expect(json).not.toContain("salesPrice");
    expect(json).not.toContain("projectProfit");
    expect(json).not.toContain("wholesaleProfit");
    expect(json).not.toContain("profitRate");
  });

  it("wholesaler DTO は profitAndLoss をそのまま保持する", () => {
    const dto = baseDto();
    const wholesaler = toProjectInfoWholesalerDto(dto);
    expect(wholesaler.profitAndLoss).toHaveLength(1);
    expect(wholesaler.profitAndLoss[0]?.salesPrice).toBe(3500000);
  });
});

describe("pickRepresentativeConstruction — 代表行選定（§16.2）", () => {
  const day = (s: string) => new Date(s);

  it("空配列は null", () => {
    expect(pickRepresentativeConstruction([])).toBeNull();
  });

  it("① 最新のステージ日付を持つ行を選ぶ", () => {
    const rows = [
      {
        id: "old",
        surveyDate: day("2026-01-01"),
        plannedDate: null,
        startedDate: null,
        completedDate: null,
        updatedAt: day("2026-01-01"),
        createdAt: day("2026-01-01"),
      },
      {
        id: "recent",
        surveyDate: null,
        plannedDate: null,
        startedDate: null,
        completedDate: day("2026-05-01"),
        updatedAt: day("2026-01-02"),
        createdAt: day("2026-01-02"),
      },
    ];
    expect(pickRepresentativeConstruction(rows)?.id).toBe("recent");
  });

  it("ステージ日付を持つ行は持たない行より優先される", () => {
    const rows = [
      {
        id: "nodate",
        surveyDate: null,
        plannedDate: null,
        startedDate: null,
        completedDate: null,
        updatedAt: day("2026-09-01"),
        createdAt: day("2026-09-01"),
      },
      {
        id: "hasdate",
        surveyDate: day("2026-02-01"),
        plannedDate: null,
        startedDate: null,
        completedDate: null,
        updatedAt: day("2026-01-01"),
        createdAt: day("2026-01-01"),
      },
    ];
    expect(pickRepresentativeConstruction(rows)?.id).toBe("hasdate");
  });

  it("② 同一ステージ日付では updatedAt 降順", () => {
    const rows = [
      {
        id: "a",
        surveyDate: day("2026-03-01"),
        plannedDate: null,
        startedDate: null,
        completedDate: null,
        updatedAt: day("2026-03-02"),
        createdAt: day("2026-03-01"),
      },
      {
        id: "b",
        surveyDate: day("2026-03-01"),
        plannedDate: null,
        startedDate: null,
        completedDate: null,
        updatedAt: day("2026-03-05"),
        createdAt: day("2026-03-01"),
      },
    ];
    expect(pickRepresentativeConstruction(rows)?.id).toBe("b");
  });

  it("③ 日付が全て null なら createdAt 降順の先頭", () => {
    const rows = [
      {
        id: "earlier",
        surveyDate: null,
        plannedDate: null,
        startedDate: null,
        completedDate: null,
        updatedAt: day("2026-01-01"),
        createdAt: day("2026-01-01"),
      },
      {
        id: "later",
        surveyDate: null,
        plannedDate: null,
        startedDate: null,
        completedDate: null,
        updatedAt: day("2026-01-01"),
        createdAt: day("2026-06-01"),
      },
    ];
    expect(pickRepresentativeConstruction(rows)?.id).toBe("later");
  });
});

describe("maskBirthDate / computeAge", () => {
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

  it("FULL 閲覧者は ISO 日付を返す", () => {
    expect(maskBirthDate("1980-05-15", fullViewer)).toBe("1980-05-15");
  });

  it("二次店（MASKED）は年代のみ", () => {
    const birth = new Date();
    birth.setFullYear(birth.getFullYear() - 45);
    expect(maskBirthDate(birth, dealerViewer)).toBe("40代");
  });

  it("null は未設定", () => {
    expect(maskBirthDate(null, fullViewer)).toBe("未設定");
    expect(maskBirthDate(undefined, dealerViewer)).toBe("未設定");
  });

  it("computeAge は満年齢、無効値は null", () => {
    const birth = new Date();
    birth.setFullYear(birth.getFullYear() - 30);
    expect(computeAge(birth)).toBe(30);
    expect(computeAge(null)).toBeNull();
    expect(computeAge("not-a-date")).toBeNull();
  });
});
