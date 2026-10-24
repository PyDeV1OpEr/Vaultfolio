import type { Asset, AssetCategory, ValuationRecord } from './types';

/**
 * Illustrative sample dataset for demo mode / first exploration.
 * Every record is synthetic and labeled DEMO — none of these values
 * represent live Sri Lankan market prices or real-world assets.
 */

export const DEMO_USER_ID = 'demo-user';

let seq = 0;
const uid = () => {
  seq += 1;
  return `demo-${seq}`;
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const daysAgoDate = (n: number) => daysAgo(n).slice(0, 10);
const yearsAgoDate = (y: number, m = 0) => {
  const d = new Date(Date.now() - (y * 365 + m * 30) * 86_400_000);
  return d.toISOString().slice(0, 10);
};

export function buildDemoData(): { assets: Asset[]; records: ValuationRecord[] } {
  seq = 0;
  const records: ValuationRecord[] = [];

  const mk = (
    category: AssetCategory,
    name: string,
    purchasedDaysAgo: number,
    priceLkr: number,
    valuations: { daysAgo: number; value: number; source: string; note?: string }[],
    extra: Partial<Asset> = {},
    attributes: Partial<Asset['attributes']> = {},
  ): Asset => {
    const a: Asset = {
      id: uid(),
      userId: DEMO_USER_ID,
      category,
      name,
      status: 'active',
      attributes: attributes as Asset['attributes'],
      purchase: {
        priceLkr,
        currency: 'LKR',
        priceOriginal: priceLkr,
        date: yearsAgoDate(Math.floor(purchasedDaysAgo / 365), Math.round((purchasedDaysAgo % 365) / 30)),
        extraCostsLkr: null,
      },
      valuation: {
        valueLkr: valuations[valuations.length - 1].value,
        method: 'user',
        sourceLabel: `${valuations[valuations.length - 1].source} · demo`,
        confidence: 'medium',
        note: 'Demo data — illustrative amount only, not a live market quote.',
        updatedAt: daysAgo(valuations[valuations.length - 1].daysAgo),
      },
      resaleValueLkr: null,
      notes: 'Demo asset created by the sample dataset.',
      image: null,
      sold: null,
      createdAt: daysAgo(valuations[0].daysAgo + 30),
      updatedAt: daysAgo(valuations[valuations.length - 1].daysAgo),
      ...extra,
    };
    for (const v of valuations) {
      records.push({
        id: uid(),
        assetId: a.id,
        userId: DEMO_USER_ID,
        valueLkr: v.value,
        method: 'user',
        sourceLabel: `${v.source} · demo`,
        confidence: 'medium',
        note: v.note ?? null,
        recordedAt: daysAgo(v.daysAgo),
      });
    }
    return a;
  };

  const assets: Asset[] = [
    mk(
      'gold_silver',
      '22k Gold Necklace (family gift)',
      900,
      742_000,
      [
        { daysAgo: 368, value: 810_000, source: 'Owner estimate' },
        { daysAgo: 150, value: 928_000, source: 'Owner estimate' },
        { daysAgo: 21, value: 1_012_000, source: 'Owner estimate' },
      ],
      { resaleValueLkr: null },
      {
        metal: 'gold',
        form: 'jewelry',
        weight: 24.5,
        weightUnit: 'g',
        purity: '22k',
        dealerSpreadPct: 8,
        craftsmanshipNote: 'Traditional Sri Lankan karattaya necklace.',
      },
    ),
    mk(
      'gold_silver',
      '1oz Fine Silver Coin',
      520,
      16_800,
      [
        { daysAgo: 200, value: 17_500, source: 'Owner estimate' },
        { daysAgo: 60, value: 18_400, source: 'Owner estimate' },
      ],
      {},
      {
        metal: 'silver',
        form: 'coin',
        weight: 1,
        weightUnit: 'ozt',
        purity: '999',
        dealerSpreadPct: 12,
      },
    ),
    mk(
      'gems_jewelry',
      'Blue Sapphire Ring (3.1ct)',
      1400,
      1_650_000,
      [
        { daysAgo: 400, value: 1_780_000, source: 'Owner estimate' },
        { daysAgo: 90, value: 2_050_000, source: 'Owner estimate' },
      ],
      {},
      {
        itemType: 'jewelry' as const,
        gemstoneType: 'Blue sapphire (Ceylon)',
        gemWeight: 3.1,
        gemWeightUnit: 'ct' as const,
        material: '18k gold setting',
        certification: 'Local gem lab cert (2019)',
        condition: 'Excellent',
      },
    ),
    mk(
      'watches',
      'Omega Seamaster 300M',
      2500,
      1_315_000,
      [
        { daysAgo: 500, value: 1_250_000, source: 'Owner estimate' },
        { daysAgo: 45, value: 1_540_000, source: 'Owner estimate' },
      ],
      {},
      {
        brand: 'Omega',
        model: 'Seamaster 300M 41mm',
        reference: '210.30.42.20.03.001',
        serial: null,
        condition: 'Very good',
        boxAndPapers: true,
      },
    ),
    mk(
      'land_property',
      'Kandy Valley Plot (demo)',
      2900,
      5_800_000,
      [
        { daysAgo: 650, value: 9_100_000, source: 'Owner estimate' },
        { daysAgo: 120, value: 11_250_000, source: 'Owner estimate' },
      ],
      {},
      {
        propertyType: 'Bare land',
        district: 'Kandy',
        city: 'Peradeniya',
        address: null,
        sizePerches: 18.5,
        sizeSqft: 5037,
        sizeSqm: 468,
        roadAccess: 'Main road, 6m frontage',
        utilities: 'Water (national), 3-phase electricity',
        zoning: 'Residential',
      },
    ),
    mk(
      'cars',
      'Toyota Aqua 2017',
      2100,
      5_350_000,
      [
        { daysAgo: 300, value: 4_100_000, source: 'Owner estimate' },
        { daysAgo: 80, value: 3_720_000, source: 'Owner estimate' },
      ],
      {},
      {
        make: 'Toyota',
        model: 'Aqua G',
        year: 2017,
        variant: 'G Grade (hybrid)',
        mileageKm: 96_000,
        fuelType: 'Hybrid petrol',
        condition: 'Good',
        registration: null,
      },
    ),
    mk(
      'motorcycles',
      'Honda CB Hornet 160R',
      1300,
      1_050_000,
      [{ daysAgo: 130, value: 720_000, source: 'Owner estimate' }],
      {},
      {
        make: 'Honda',
        model: 'CB Hornet 160R',
        year: 2021,
        engineCc: 162,
        mileageKm: 21_500,
        condition: 'Good',
      },
    ),
    mk(
      'other',
      'Restored Antique Writing Desk',
      700,
      310_000,
      [
        { daysAgo: 220, value: 380_000, source: 'Owner estimate' },
        { daysAgo: 15, value: 415_000, source: 'Owner estimate' },
      ],
      {},
      {
        kind: 'Antique furniture',
        description: 'British colonial era desk, restored 2024.',
      },
    ),
  ];

  return { assets, records };
}
