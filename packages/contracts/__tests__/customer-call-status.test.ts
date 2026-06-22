// Vitest — バッチ B コール状況のスキーマ・値域・DTO（CALL_STATUS_VALUES / CallStatusEnum /
// ProjectCallStatusSchema / ProjectCallsDto の二次店マスキング方針）。
//   1. CallStatusEnum: not_done/done/unnecessary の受理・不正値 reject
//   2. ProjectCallStatusSchema: 受理 / null クリア / 省略許容 / 不正ステータス reject
//   3. CALL_STATUS_VALUES は単一の真実（enum と一致）
//   4. toProjectInfoDealerDto は calls をそのまま保持（電話はローダで maskPhone 済み）

import { describe, expect, it } from "vitest";

import {
  CALL_STATUS_VALUES,
  CallStatusEnum,
  ProjectCallStatusSchema,
} from "../src/schemas/customer.js";
import {
  toProjectInfoDealerDto,
  type ProjectInfoDto,
} from "../src/dto/project-info.js";

describe("CallStatusEnum / CALL_STATUS_VALUES — 値域（バッチ B）", () => {
  it("CALL_STATUS_VALUES は not_done/done/unnecessary の 3 値", () => {
    expect(CALL_STATUS_VALUES).toEqual(["not_done", "done", "unnecessary"]);
  });

  it("enum は 3 値を受理する", () => {
    for (const v of CALL_STATUS_VALUES) {
      expect(CallStatusEnum.parse(v)).toBe(v);
    }
  });

  it("不正値は reject", () => {
    expect(CallStatusEnum.safeParse("DONE").success).toBe(false);
    expect(CallStatusEnum.safeParse("scheduled").success).toBe(false);
    expect(CallStatusEnum.safeParse("").success).toBe(false);
  });

  it("enum の値域は CALL_STATUS_VALUES と一致（単一の真実）", () => {
    expect(CallStatusEnum.options).toEqual([...CALL_STATUS_VALUES]);
  });
});

describe("ProjectCallStatusSchema — 保存ペイロード（バッチ B）", () => {
  it("全フィールド指定を受理", () => {
    const parsed = ProjectCallStatusSchema.parse({
      customerId: "c1",
      postCompletionCallStatus: "done",
      postCompletionCallPreferredAt: "2026-06-20T10:00:00.000Z",
      loanCompletionCallStatus: "not_done",
      loanCompletionCallPreferredAt: "2026-06-21",
      generalCallPreferredTime: "平日19:00以降",
      maekakuPreferredPhone: "080-1234-5678",
    });
    expect(parsed.postCompletionCallStatus).toBe("done");
    expect(parsed.generalCallPreferredTime).toBe("平日19:00以降");
  });

  it("null でクリアできる（status / 日時 / 文字列 / 電話）", () => {
    const parsed = ProjectCallStatusSchema.parse({
      customerId: "c1",
      postCompletionCallStatus: null,
      postCompletionCallPreferredAt: null,
      loanCompletionCallStatus: null,
      loanCompletionCallPreferredAt: null,
      generalCallPreferredTime: null,
      maekakuPreferredPhone: null,
    });
    expect(parsed.postCompletionCallStatus).toBeNull();
    expect(parsed.maekakuPreferredPhone).toBeNull();
  });

  it("省略（部分更新）を許容する", () => {
    const parsed = ProjectCallStatusSchema.parse({ customerId: "c1" });
    expect(parsed.postCompletionCallStatus).toBeUndefined();
    expect(parsed.generalCallPreferredTime).toBeUndefined();
  });

  it("customerId 必須 / 不正ステータスは reject", () => {
    expect(ProjectCallStatusSchema.safeParse({}).success).toBe(false);
    expect(
      ProjectCallStatusSchema.safeParse({ customerId: "c1", postCompletionCallStatus: "DONE" })
        .success,
    ).toBe(false);
  });
});

describe("toProjectInfoDealerDto — calls セクションの保持（電話はローダで maskPhone 済み）", () => {
  function dtoWithCalls(): ProjectInfoDto {
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
      organization: { tossUpUserName: null, closingUserName: null, tossDept: null, belongDept: null },
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
        maekakuStatus: "done",
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
        maekakuStatus: "done",
        // ローダで maskMobilePhone を通した後の値（二次店では下4桁マスク済み）。
        maekakuPreferredPhone: "***-****-5678",
        postCompletionCallStatus: "done",
        postCompletionCallPreferredAt: "2026-06-20T10:00:00.000Z",
        loanCompletionCallStatus: "not_done",
        loanCompletionCallPreferredAt: null,
        generalCallPreferredTime: "平日19:00以降",
      },
    };
  }

  it("二次店 DTO に calls が保持され、生電話番号は露出しない", () => {
    const dealer = toProjectInfoDealerDto(dtoWithCalls());
    expect(dealer.calls.postCompletionCallStatus).toBe("done");
    expect(dealer.calls.maekakuPreferredPhone).toBe("***-****-5678");
    const json = JSON.stringify(dealer.calls);
    // マスク前の生番号断片が混入していないこと。
    expect(json).not.toContain("080-");
  });
});
