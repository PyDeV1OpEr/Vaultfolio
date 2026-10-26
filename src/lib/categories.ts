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
    label: 'Precious Metals',
    shortLabel: 'Metals',
    icon: Coins,
    blurb: 'Gold, silver, copper, platinum & bullion, coins and fine jewelry',
  },
  {
    id: 'gems_jewelry',
    label: 'Gems & Jewelry',
    shortLabel: 'Gems',
    icon: Gem,
    blurb: 'Gemstones, diamonds, rings, necklaces and certified pieces',
  },
  {
    id: 'watches',
    label: 'Luxury Watches',
    shortLabel: 'Watches',
    icon: Watch,
    blurb: 'Fine timepieces with reference, condition, box & papers tracking',
  },
  {
    id: 'land_property',
    label: 'Land & Property',
    shortLabel: 'Land',
    icon: LandPlot,
    blurb: 'Plots, houses and estates measured in Sri Lankan perches & sqft',
  },
  {
    id: 'cars',
    label: 'Cars',
    shortLabel: 'Cars',
    icon: Car,
    blurb: 'Motor cars with mileage, variant and condition tracking',
  },
  {
    id: 'motorcycles',
    label: 'Motorcycles',
    shortLabel: 'Bikes',
    icon: Bike,
    blurb: 'Motorcycles and scooters with engine cc and condition',
  },
  {
    id: 'other',
    label: 'Other Physical Assets',
    shortLabel: 'Other',
    icon: Package,
    blurb: 'Antiques, art, collectibles and other physical valuables',
  },
];

export const categoryMeta = (c: AssetCategory): CategoryMeta =>
  CATEGORIES.find((x) => x.id === c) ?? CATEGORIES[CATEGORIES.length - 1];

export const CATEGORY_LABEL: Record<AssetCategory, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label]),
) as Record<AssetCategory, string>;
