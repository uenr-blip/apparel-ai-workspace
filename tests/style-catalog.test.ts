import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import {
  createStyleOption,
  listStyleCatalog,
  removeStyleOption,
} from "@/server/services/style-catalog";
import { createStyleMaster } from "@/server/services/style-create";
import { getStyleThread, listStyleSummaries } from "@/server/services/style-thread";
import { resetDatabase } from "./helpers";

describe("主档资料选项", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("新建主档可点选品牌/分层品类/类型/年份，换年不是新款号，名单可增加", async () => {
    const catalog = await listStyleCatalog(IDS.orgDemo);
    expect(catalog.types.map((item) => item.name)).toEqual(expect.arrayContaining(["内部", "外采"]));
    expect(catalog.years.map((item) => item.name)).toEqual(expect.arrayContaining(["2026"]));
    const knit = catalog.categories.find((item) => item.name === "针织");
    const tee = knit?.children.find((item) => item.name === "短袖T恤");
    expect(tee).toBeTruthy();

    const brand = await createStyleOption({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      kind: "brand",
      name: " 北岸线 ",
    });
    const created = await createStyleMaster({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      code: "ST-CAT-01",
      name: "资料点选款",
      brandOptionId: brand.id,
      categoryOptionId: tee!.id,
      typeOptionId: catalog.types.find((item) => item.name === "内部")?.id,
      yearOptionId: catalog.years.find((item) => item.name === "2026")?.id,
    });
    const style = await prisma.style.findUniqueOrThrow({ where: { id: created.styleId } });
    expect(style.category).toBe("针织 / 短袖T恤");
    expect(style.code).toBe("ST-CAT-01");

    const card = (await listStyleSummaries(IDS.orgDemo)).find((row) => row.id === created.styleId);
    expect(card?.brandName).toBe("北岸线");
    expect(card?.categoryLabel).toBe("针织 / 短袖T恤");
    expect(card?.typeName).toBe("内部");
    expect(card?.yearName).toBe("2026");

    const thread = await getStyleThread(IDS.orgDemo, created.styleId);
    expect(thread.identifiers.brand?.name).toBe("北岸线");
    expect(thread.identifiers.category?.label).toBe("针织 / 短袖T恤");
    expect(JSON.stringify(thread)).not.toMatch(/大货号已核实|Fololstop/);
  });

  it("已占用的选项不能删；工厂和外组织不能改", async () => {
    const catalog = await listStyleCatalog(IDS.orgDemo);
    const inner = catalog.types.find((item) => item.name === "内部")!;
    await createStyleMaster({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      code: "ST-CAT-02",
      name: "占着类型",
      typeOptionId: inner.id,
    });
    await expect(
      removeStyleOption({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        optionId: inner.id,
      }),
    ).rejects.toThrow(/先从款上撤下/);

    await expect(
      createStyleOption({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        kind: "brand",
        name: "工厂冒认",
      }),
    ).rejects.toThrow(/无权/);

    const brand = await createStyleOption({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      kind: "brand",
      name: "北岸线",
    });
    await expect(
      createStyleMaster({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        code: "ST-ISO-CAT",
        name: "隔离点选",
        brandOptionId: brand.id,
      }),
    ).rejects.toThrow(/不存在|不属于/);
  });

  it("未占用的品牌/子类可从名单撤下，不删款式", async () => {
    const brand = await createStyleOption({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      kind: "brand",
      name: "试撤品牌",
    });
    await removeStyleOption({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      optionId: brand.id,
    });
    const catalog = await listStyleCatalog(IDS.orgDemo);
    expect(catalog.brands.map((item) => item.name)).not.toContain("试撤品牌");

    const knit = catalog.categories.find((item) => item.name === "针织");
    expect(knit).toBeTruthy();
    await expect(
      removeStyleOption({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        optionId: knit!.id,
      }),
    ).rejects.toThrow(/先把下面的子类撤下/);
  });
});
