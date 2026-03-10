import {
  extractStructuralGraph,
  validateStructuralTransition,
} from "../src/structural-validator.js";
import { hasStructuralMarkerBoundaryViolations } from "../src/structural-document.js";

describe("structural validator", () => {
  test("extracts marker graph and marker-boundary gap graph", () => {
    const markdown = [
      "<!-- section:hero -->",
      "",
      "",
      "<!-- /section:hero -->",
    ].join("\n");

    const graph = extractStructuralGraph(markdown);

    expect(graph.markerGraph).toEqual(["section:hero", "/section:hero"]);
    expect(graph.boundaryGapGraph).toEqual([2]);
  });

  test("accepts seeded transition when previous document has no markers", () => {
    const previous = "Intro paragraph";
    const next = ["<!-- section:hero -->", "<!-- /section:hero -->"].join("\n");

    const result = validateStructuralTransition(previous, next);

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("seeded-next-graph");
  });

  test("rejects marker graph mismatch", () => {
    const previous = ["<!-- section:hero -->", "<!-- /section:hero -->"].join(
      "\n",
    );
    const next = ["<!-- section:body -->", "<!-- /section:body -->"].join("\n");

    const result = validateStructuralTransition(previous, next);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("marker-graph-mismatch");
  });

  test("rejects marker-boundary gap mismatch", () => {
    const previous = [
      "<!-- section:hero -->",
      "",
      "<!-- /section:hero -->",
    ].join("\n");
    const next = [
      "<!-- section:hero -->",
      "",
      "",
      "<!-- /section:hero -->",
    ].join("\n");

    const result = validateStructuralTransition(previous, next);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("gap-graph-mismatch");
  });

  test("LF and CRLF produce identical marker positions and gap boundaries", () => {
    const lf = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# Heading",
      "",
      "<!-- section:body -->",
      "Body",
    ].join("\n");
    const crlf = lf.replace(/\n/g, "\r\n");

    const lfGraph = extractStructuralGraph(lf);
    const crlfGraph = extractStructuralGraph(crlf);

    expect(crlfGraph.markerGraph).toEqual(lfGraph.markerGraph);
    expect(crlfGraph.markerPositions).toEqual(lfGraph.markerPositions);
    expect(crlfGraph.boundaryGapGraph).toEqual(lfGraph.boundaryGapGraph);
  });

  test("marker boundary validator allows trailing whitespace on marker lines", () => {
    const markdown = [
      "<!-- section:hero -->",
      "",
      "<!-- description... --> ",
      "Body text",
      "",
    ].join("\n");

    expect(hasStructuralMarkerBoundaryViolations(markdown)).toBe(false);
  });
});
