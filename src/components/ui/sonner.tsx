import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Dark-only toaster (the app has no theme switch). */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "!bg-[#141414] !border-white/12 !text-white !rounded-[10px] !font-sans",
          description: "!text-white/60",
          actionButton: "!bg-[#5865F2] !text-white",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
