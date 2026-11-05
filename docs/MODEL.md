# The Ouroseed model

Ouroseed asks a precise, finite question: **which allowed external kit has the lowest weighted cost, permits a legal sequence of recipes, and leaves the requested inventory after the kit is returned?** The quantities are discrete, the recipes are sequential, and the inventory capacities are hard limits. It is a teaching and exploration model, not a validated industrial simulator.

## Input

A model is a JSON object with `version: 1`, `name`, optional descriptive text, `resources`, `recipes`, and `goal`. Each resource has:

| Field | Meaning |
| --- | --- |
| `id` | Unique resource identifier used in quantity maps. |
| `label` | Display name. |
| `initial` | Inventory already present before importing the kit. |
| `capacity` | Maximum inventory allowed at every state, including the initial state with the kit. |
| `seedMax` | Maximum number of units allowed in the external kit. Zero forbids that external supply. |
| `seedCost` | Positive integer cost per external unit, used to rank kits. This can represent transport mass, difficulty, or a chosen abstract cost; it is not a computed financial price. |

Inventories and recipe quantities are nonnegative integers. Quantities omitted from a map mean zero. A recipe has `id`, `label`, and three quantity maps: `consume`, `produce`, and `require`. `goal` is a quantity map giving minimum retained inventory, not an exact final inventory.

## Recipe semantics

For a state vector **x** and a recipe with consumed vector **a**, produced vector **b**, and reusable required vector **q**, the recipe is enabled exactly when:

```text
x[i] >= a[i] + q[i]             for every resource i
0 <= x[i] - a[i] + b[i] <= capacity[i]
```

The next state is:

```text
x'[i] = x[i] - a[i] + b[i]
```

Requirements are **additional to consumed quantities**, not an alternative way to specify the same input. A recipe that consumes one unit of a resource and requires one reusable unit needs two units before it starts. It leaves the required unit available. Produced units cannot satisfy the requirements of the recipe that produces them.

Recipes occur atomically and one at a time. The capacity check applies to the state after consumption and production as one transition; there is no intermediate storage or concurrency model. Exceeding a capacity disables the recipe. Quantities are never silently clipped or discarded.

## Gift and loan modes

Let **x₀** be the supplied initial inventory, **s** an external seed kit, **g** the goal, and **xₙ** the inventory after a legal recipe sequence. Every kit obeys:

```text
0 <= s[i] <= seedMax[i]
x₀[i] + s[i] <= capacity[i]
```

Both modes start at **x₀ + s**.

In **gift mode**, the external kit does not need to be returned:

```text
xₙ[i] >= g[i]
retained[i] = xₙ[i]
```

In **loan mode**, the goal must still hold after returning the kit:

```text
xₙ[i] >= g[i] + s[i]
retained[i] = xₙ[i] - s[i]
```

Repayment is in equivalent units of the same resource type. It does not track the identity, provenance, or physical wear of individual objects. To distinguish a charged battery from an empty battery, or a working tool from a worn tool, represent those as different resources and write transitions between them. Returned resources are removed together at the end; staged borrowing or early repayment is not modeled.

Returning the kit and reaching a goal does **not** prove indefinite self-sufficiency. A plan can exhaust other initial stocks. The inventory replay makes those losses visible, but the model has no implicit resupply, energy, maintenance, time, uncertainty, or physical conservation laws. Any such constraint must be represented explicitly by resources and recipes.

## Search and claims

The kit cost is:

```text
cost(s) = sum(seedCost[i] * s[i])
```

The solver enumerates allowed kits by cost, then explores reachable inventories for each kit with breadth-first search. This finds a shortest recipe sequence for a reachable kit because every recipe counts as one step. It is not a shortest-duration or cheapest-operation plan.

When the search completes, `optimal` means the returned kits have the lowest weighted kit cost within this model and its allowed kit bounds. All kits at that winning cost are considered. It does not mean every feasible kit, every nondominated kit, or every equally short recipe ordering is returned. `units` is a presentation and ordering value; cost is the optimization objective.

`infeasible` means exhaustive search found no feasible kit in the finite model. `inconclusive` means the candidate or state budget interrupted the search, so failure or global optimality is not established. A hard inventory capacity is part of the model; a computational budget is a limit on what the solver has checked. These are different kinds of bounds.

For a fixed kit, at most `product(capacity[i] + 1)` distinct inventory vectors exist. Exact enumeration can still become expensive. Use small models, modest capacities, and few externally available resources.

## Witness verification

A witness records the full model, mode, kit, recipe IDs in execution order, state snapshots, final inventory, and retained inventory. The separate verifier replays each step, checks inventory and capacity requirements, checks recorded states, and checks the terminal goal and repayment rule.

A valid witness establishes **feasibility of that sequence for that supplied model**. It does not independently establish cheapest-kit optimality, completeness of the recipe list, correctness of a physical model, or trustworthiness of a model's author. Optimality requires the solver's exhaustive comparisons, not merely a successful replay.

## Included scenarios

| File | What it demonstrates | Expected loan result | Expected gift result |
| --- | --- | --- | --- |
| [`locked-workshop.json`](../examples/locked-workshop.json) | Mutually dependent machines can be bootstrapped with a returnable starter. | Two minimum kits of cost 3: one lathe or one mill. Each needs 6 steps and retains one of each machine. | Same minimum kits, each needs 3 steps. The gifted machine counts toward the goal. |
| [`shared-consumable.json`](../examples/shared-consumable.json) | Two graph paths compete for one consumable. | Infeasible. | Infeasible. |
| [`borrowed-battery.json`](../examples/borrowed-battery.json) | A useful external supply may be consumed beyond repayment. | Infeasible. | One charged battery, cost 2, one step. |
| [`regenerative-starter.json`](../examples/regenerative-starter.json) | A seed can be regenerated and returned while retaining a productive base. | One culture unit, cost 1, three steps. | One culture unit, cost 1, two steps. |

The examples are deliberately synthetic. Their purpose is to expose assumptions and make the difference between a connected diagram, a feasible execution, and a repayable bootstrap easy to inspect.
