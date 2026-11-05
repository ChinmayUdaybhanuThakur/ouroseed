# Prior art and the scope of the originality claim

Research date: **6 November 2026**. This is a targeted public-web review, not an exhaustive literature review or a patent search.

## The specific thing built

Ouroseed asks a practical question about a small recipe system:

> What is the cheapest kit we can borrow to reach our target, then return in full?

For a supplied initial inventory `I`, borrowed kit `S`, and retained target `G`, a successful returnable plan starts at `I + S` and finishes with at least `G + S`, component by component. Gift mode instead requires only `G`. Repayment concerns quantities of interchangeable item types; the tool does not track the identity or condition of individual physical objects.

The intended contribution is the combined, inspectable workflow: bounded integer inventory, sequential recipes, separate reusable requirements and consumed inputs, weighted minimum kit search, gift-versus-loan comparison, and a replayable inventory trace. An independently implemented trace verifier checks a candidate plan. This is an original implementation and application design, **not a claim to have invented resource planning, catalytic bootstrapping, Petri nets, or minimum initial resources**.

The searches below did not locate a tool with this exact user-facing workflow. That limited finding does not establish that no equivalent software exists, has existed privately, or uses different terminology.

## Closest work found

| Source | What already exists | How Ouroseed is scoped differently |
| --- | --- | --- |
| [Watanabe, Mizobata and Onaga, *Minimum Initial Marking Problems of Petri Nets* (1989)](https://globals.ieice.org/en_transactions/transactions/10.1587/e72-e_12_1390/_p) | Minimum starting tokens permitting a legal transition sequence with a given firing-count vector; complexity and approximation algorithms. | Ouroseed optimizes a supplied borrowing cost over bounded candidate kits for an inventory goal and repayment requirement, without a prescribed firing-count vector. It uses ordinary finite-state search, not a new complexity result. |
| [Taoka, Yamauchi and Watanabe, *Improved Heuristic Algorithms for Minimizing Initial Markings of Petri Nets* (2005)](https://globals.ieice.org/en_transactions/fundamentals/10.1093/ietfec/e88-a.11.3051/_p) | Further algorithms for economical initial resources and legal firing sequences. | Acknowledges that optimizing startup resources is established work. Ouroseed favors small inspectable examples and explicit bounded results. |
| [Seed2LP, authors' repository](https://github.com/bioasp/seed2lp) | Metabolic seed inference using logical reasoning and flux constraints, including minimum and subset-minimum seed sets. | Ouroseed is an item-count workshop planner with individual sequential execution and a terminal repayment constraint. It is not a metabolic reconstruction or steady-state flux package. |
| [Carr and Borenstein, *NetSeed* (2012)](https://academic.oup.com/bioinformatics/article/28/5/734/247298) | A web tool for calculating and visualizing metabolic network seed sets using network structure. | Ouroseed retains finite quantities, consumption, recipe order, and a repayment obligation. Web-based seed visualization is itself established. |
| [Peng, Linderoth and Baum, *The hierarchical organization of autocatalytic reaction networks and its relevance to the origin of life* (2022)](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1010498) | Seed-dependent autocatalytic systems activated by transient seeds; discussion includes species consumed and fully regenerated across a sequence of reactions. | This is close conceptual precedent for returnable seeds. Ouroseed presents a bounded, weighted borrowing problem for workshops with explicit inventory witnesses; it does not claim to originate the idea of regenerating a seed. |
| [PetriNet-Editor-Exporter-LM, authors' repository](https://github.com/lamouriml/PetriNet-Editor-Exporter-LM) | A client-side Petri-net editor with read arcs, capacity constraints, simulation, and export for formal analysis. | Browser-local token execution and capacity checks are not new. Ouroseed centers the borrow/build/repay optimization and comparison rather than general net editing. |
| [The Seed Factory Project, project repository](https://github.com/danielravennest/seed-factory-project) | An open hardware/software initiative for self-expanding production systems and starter equipment. | This establishes the broader seed-factory motivation. Ouroseed is a small executable planning model, not a demonstrated autonomous factory. |

## Search record

The following exact query families were run against a general web search engine, including searches targeting GitHub. Results were inspected for relevant primary papers and project repositories; low-relevance shopping, finance, and gardening results were excluded. No result count is treated as proof of absence.

- `"self replicating" "factory" "bootstrap" software planner`
- `"seed factory" software planner github`
- `"Petri net" "minimal" "initial marking" synthesis tool`
- `github "Petri net" "initial marking" "minimum"`
- `"metabolic" "seed" "network" "minimal" github tool`
- `"minimal seed" "catalyst" network software`
- `"workshop" "bootstrap" "planner" "machines"`
- `"factory" "replayable" "seed"`
- `"Petri net" "borrow" "return" "seed"`
- `"returnable" "seed" "planner"`
- `"bootstrap" "loan" "catalyst" software`
- `"seed" "borrowed" "stoichiometric"`
- `"minimum" "catalytic" "seed" "network"`
- `"chemical reaction" "borrowed" "returned" "planning"`

## Limits of what a result proves

A valid trace proves that the supplied abstract recipes can reach the supplied target and, in returnable mode, repay the chosen kit under the model's rules. It does not prove physical feasibility, autonomous operation, repeatability forever, resistance to arbitrary failures, or industrial self-sufficiency. Energy, labor, wear, timing, and supply limits matter only if the user models them.

Minimum-cost and impossibility claims apply only when the relevant finite search has completed within the declared inventory and borrowing bounds. A computation limit must remain an incomplete result. Checking one successful trace independently verifies feasibility; it does not independently establish that no cheaper kit exists.

If you know a closer implementation or an earlier equivalent workflow, please open an issue with a link and a concrete comparison. The claim should narrow as evidence improves.
