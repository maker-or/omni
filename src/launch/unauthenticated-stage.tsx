import { SignIn } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Elevated } from "@/lib/elevated";
import { AmbientPixelField } from "@/components/ambient-pixel-field";

interface UnauthenticatedStageProps {
  isLaunchingAuth: boolean;
  onAuthRedirect: (kind: "sign-in" | "sign-up") => void;
}

export function UnauthenticatedStage({
  isLaunchingAuth,
  onAuthRedirect,
}: UnauthenticatedStageProps) {
  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#171717] text-foreground flex items-center justify-center p-6">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <AmbientPixelField intensity={0.35} fadeStart={0.8} />
      </div>

      {/* Bounded Card */}
      <Elevated
        offset={2}
        className="w-full max-w-sm z-10 flex flex-col items-center text-center gap-6"
      >
        <Button
          type="button"
          variant="secondary"
          size="lg"
          leadingIcon={SignIn}
          onClick={() => onAuthRedirect("sign-in")}
          disabled={isLaunchingAuth}
          className="w-full py-6 text-base"
        >
          {isLaunchingAuth ? "Opening browser..." : "Sign in"}
        </Button>
      </Elevated>
    </div>
  );
}
