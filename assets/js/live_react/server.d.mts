import type React from "react";

export function getRender(
  components: Record<string, React.ElementType>,
): (
  name: string,
  props: Record<string, unknown> | null,
  slots?: { default?: string },
) => string;
