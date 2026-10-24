import {
  Bike,
  Car,
  Coins,
  Gem,
  LandPlot,
  Package,
  Watch,
  type LucideIcon,
} from 'lucide-react';
import type { AssetCategory } from './types';

export interface CategoryMeta {
  id: AssetCategory;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  blurb: string;
}

export const CATEGORIES: CategoryMeta[] = [
  {
    id: 'gold_silver',
    label: 'Gold & Silver',
    shortLabel: 'Metals',
    icon: Coins,
    blurb: 'Bullion, coins and fine jewelry — valued from metal content',
  },
  {
    id: 'gems_jewelry',
    label: 'Gems & Jewelry',
    shortLabel: 'Gems',
    icon: Gem,
    blurb: 'Gemstones, rings, necklaces and certified pieces',
  },
  {
    id: 'watches',
    label: 'Watches',
    shortLabel: 'Watches',
    icon: Watch,
    blurb: 'Timepieces with condition, box & papers tracking',
  },
  {
    id: 'land_property',
    label: 'Land & Property',
    shortLabel: 'Land',
    icon: LandPlot,
    blurb: 'Plots, houses and estates measured in perches',
  },
  {
    id: 'cars',
    label: 'Cars',
    shortLabel: 'Cars',
    icon: Car,
    blurb: 'Motor cars with mileage and condition tracking',
  },
  {
    id: 'motorcycles',
    label: 'Motorcycles',
    shortLabel: 'Bikes',
    icon: Bike,
    blurb: 'Motorcycles and scooters',
  },
  {
    id: 'other',
    label: 'Other Assets',
    shortLabel: 'Other',
    icon: Package,
    blurb: 'Any physical valuable worth tracking',
  },
];

export const categoryMeta = (c: AssetCategory): CategoryMeta =>
  CATEGORIES.find((x) => x.id === c) ?? CATEGORIES[CATEGORIES.length - 1];

export const CATEGORY_LABEL: Record<AssetCategory, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label]),
) as Record<AssetCategory, string>;
