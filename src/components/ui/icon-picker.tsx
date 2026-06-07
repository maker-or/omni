"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Cherries as CherriesIcon,
  Checkerboard as CheckerboardIcon,
  Cheers as CheersIcon,
  Clover as CloverIcon,
  Club as ClubIcon,
  CodesandboxLogo as CodesandboxLogoIcon,
  Coins as CoinsIcon,
  CowboyHat as CowboyHatIcon,
  Detective as DetectiveIcon,
  DiamondsFour as DiamondsFourIcon,
  DiscoBall as DiscoBallIcon,
  Drone as DroneIcon,
  Fan as FanIcon,
  Feather as FeatherIcon,
  FilmReel as FilmReelIcon,
  FilmStrip as FilmStripIcon,
  FireTruck as FireTruckIcon,
  Flower as FlowerIcon,
  FlowerLotus as FlowerLotusIcon,
  Flashlight as FlashlightIcon,
  FlowerTulip as FlowerTulipIcon,
  FlyingSaucer as FlyingSaucerIcon,
  Football as FootballIcon,
  FootballHelmet as FootballHelmetIcon,
  Ghost as GhostIcon,
  Grains as GrainsIcon,
  HandSoap as HandSoapIcon,
  HighHeel as HighHeelIcon,
  Meteor as MeteorIcon,
  Moped as MopedIcon,
  MopedFront as MopedFrontIcon,
  Motorcycle as MotorcycleIcon,
  OrangeSlice as OrangeSliceIcon,
  Orange as OrangeIcon,
  PawPrint as PawPrintIcon,
  Pinwheel as PinwheelIcon,
  PingPong as PingPongIcon,
  Plant as PlantIcon,
  PottedPlant as PottedPlantIcon,
  Popsicle as PopsicleIcon,
  Popcorn as PopcornIcon,
  Rabbit as RabbitIcon,
  Snowflake as SnowflakeIcon,
  SoccerBall as SoccerBallIcon,
  Spade as SpadeIcon,
  Train as TrainIcon,
} from "@phosphor-icons/react";

const ICONS = [
  { name: "Cherries", icon: CherriesIcon },
  { name: "Checkerboard", icon: CheckerboardIcon },
  { name: "Cheers", icon: CheersIcon },
  { name: "Clover", icon: CloverIcon },
  { name: "Club", icon: ClubIcon },
  { name: "CodesandboxLogo", icon: CodesandboxLogoIcon },
  { name: "Coins", icon: CoinsIcon },
  { name: "CowboyHat", icon: CowboyHatIcon },
  { name: "Detective", icon: DetectiveIcon },
  { name: "DiamondsFour", icon: DiamondsFourIcon },
  { name: "DiscoBall", icon: DiscoBallIcon },
  { name: "Drone", icon: DroneIcon },
  { name: "Fan", icon: FanIcon },
  { name: "Feather", icon: FeatherIcon },
  { name: "FilmReel", icon: FilmReelIcon },
  { name: "FilmStrip", icon: FilmStripIcon },
  { name: "FireTruck", icon: FireTruckIcon },
  { name: "Flower", icon: FlowerIcon },
  { name: "FlowerLotus", icon: FlowerLotusIcon },
  { name: "Flashlight", icon: FlashlightIcon },
  { name: "FlowerTulip", icon: FlowerTulipIcon },
  { name: "FlyingSaucer", icon: FlyingSaucerIcon },
  { name: "Football", icon: FootballIcon },
  { name: "FootballHelmet", icon: FootballHelmetIcon },
  { name: "Ghost", icon: GhostIcon },
  { name: "Grains", icon: GrainsIcon },
  { name: "HandSoap", icon: HandSoapIcon },
  { name: "HighHeel", icon: HighHeelIcon },
  { name: "Meteor", icon: MeteorIcon },
  { name: "Moped", icon: MopedIcon },
  { name: "MopedFront", icon: MopedFrontIcon },
  { name: "Motorcycle", icon: MotorcycleIcon },
  { name: "OrangeSlice", icon: OrangeSliceIcon },
  { name: "Orange", icon: OrangeIcon },
  { name: "PawPrint", icon: PawPrintIcon },
  { name: "Pinwheel", icon: PinwheelIcon },
  { name: "PingPong", icon: PingPongIcon },
  { name: "Plant", icon: PlantIcon },
  { name: "PottedPlant", icon: PottedPlantIcon },
  { name: "Popsicle", icon: PopsicleIcon },
  { name: "Popcorn", icon: PopcornIcon },
  { name: "Rabbit", icon: RabbitIcon },
  { name: "Snowflake", icon: SnowflakeIcon },
  { name: "SoccerBall", icon: SoccerBallIcon },
  { name: "Spade", icon: SpadeIcon },
  { name: "Train", icon: TrainIcon },
];

export interface IconPickerProps {
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export const IconPicker = forwardRef<HTMLButtonElement, IconPickerProps>(
  ({ value, onValueChange, className }, ref) => {
    const selectedIconObj = ICONS.find((i) => i.name === value);
    const SelectedIcon = selectedIconObj?.icon;

    return (
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          ref={ref}
          icon={SelectedIcon}
          placeholder="Select an icon..."
          className={cn("w-full", className)}
        />
        <SelectContent>
          {ICONS.map((item, index) => (
            <SelectItem key={item.name} value={item.name} index={index} icon={item.icon}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  },
);

IconPicker.displayName = "IconPicker";

export { ICONS as PROJECT_ICON_OPTIONS };

export function ProjectIcon({ name, className }: { name: string | null; className?: string }) {
  const item = ICONS.find((i) => i.name === name);
  const Icon = item?.icon ?? GhostIcon;
  return <Icon className={className} />;
}
