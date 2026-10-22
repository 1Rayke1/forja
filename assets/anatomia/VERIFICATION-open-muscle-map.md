# Name verification

How well each muscle name matches the drawn panels. This is a position-based review: anatomy pages describe where a muscle sits, not how this artwork draws it, so it is not a dissection-level guarantee.

**Status:** `source-backed` = placement confirmed by an anatomy reference; `partly verified` = the muscles are right but the drawing merges several; `likely` = standard anatomy, not checked against a page; `uncertain` = the drawing is ambiguous.

Reviewed on the male map. The female map has the same panel keys, muscle IDs and selectability as the male map (checked by `scripts/verify-data.mjs`); its artwork was compared visually for the uncertain muscles and the placement matches. Anatomy sources were not checked against the female drawing separately.

Summary: 14 source-backed, 6 partly verified, 16 likely, 1 uncertain (of 37 catalog entries). Sources for the latest pass (2026-10-17) are listed in `SOURCES.md`.

| `muscleId` | Name | Group | Selectable | Panels | Status | Notes |
|---|---|---|---|---|---|---|
| `sternocleidomastoid` | Sternocleidomastoid | neck | yes | 4 | source-backed | Superficial anterior neck muscle. The four panels are drawn as separate slivers; head boundaries are not resolved. |
| `trapezius` | Trapezius | upper_back | yes | 8 | source-backed | Upper, middle and lower fibres span neck to mid-back. The small piece on top of each shoulder is the acromial part. |
| `posterior_rotator_cuff` | Posterior rotator cuff | upper_back | yes | 2 | partly verified | One oval under the rear deltoid: infraspinatus fills most of the infraspinous fossa and teres minor runs along its lateral border. The drawing cannot separate them. |
| `latissimus_dorsi` | Latissimus dorsi (lats) | upper_back | yes | 2 | source-backed | Broad flat muscle from the lower back to the humerus. |
| `anterior_deltoid` | Anterior deltoid | shoulders | yes | 2 | likely | Standard anatomy. |
| `lateral_deltoid` | Lateral deltoid | shoulders | yes | 4 | likely | Standard anatomy. |
| `posterior_deltoid` | Posterior deltoid | shoulders | yes | 2 | likely | Standard anatomy; it rests over the infraspinatus. |
| `pectoralis_major` | Pectoralis major (chest) | chest | yes | 2 | likely | Standard anatomy. |
| `biceps_brachii` | Biceps brachii | upper_arms | yes | 2 | likely | Standard anatomy. |
| `brachialis` | Brachialis | upper_arms | yes | 2 | uncertain | StatPearls places it deeper than the biceps in the anterior lower arm and does not state where it shows at the surface. The thin outer-arm strip is consistent with the lateral edge of the brachialis but cannot be confirmed from the drawing; it could also be the lateral triceps edge. |
| `triceps_brachii` | Triceps brachii | upper_arms | yes | 6 | source-backed | Long, lateral and medial heads (the medial head is deepest and shows near the elbow). All six panels share one id. |
| `serratus_anterior` | Serratus anterior | core | yes | 8 | likely | Four digitations per side; the lowest piece borders the external oblique and is ambiguous in the drawing. |
| `rectus_abdominis` | Rectus abdominis (abs) | core | yes | 8 | likely | Upper, middle, lower and inferior tiles are portions of one muscle. |
| `external_oblique` | External oblique | core | yes | 4 | likely | Front flank panels, plus the rear waist panels beside the erector spinae (the external oblique borders the lumbar triangle). |
| `forearm_flexors` | Forearm flexors | forearms | yes | 2 | likely | Group label; the drawing does not isolate individual flexors. |
| `forearm_extensors` | Forearm extensors | forearms | yes | 2 | source-backed | Posterior superficial group, including the brachioradialis on the radial edge; one group label. |
| `tensor_fasciae_latae` | Tensor fasciae latae | hips | yes | 2 | likely | Upper outer hip. |
| `sartorius` | Sartorius | hips | yes | 2 | source-backed | Most superficial anterior thigh muscle, running diagonally. |
| `iliopsoas` | Iliopsoas (hip flexors) | hips | yes | 2 | partly verified | Front strap from the hip bone into the groin, directly medial to the sartorius panel. The iliopsoas forms the lateral floor of the femoral triangle, whose lateral border is the sartorius (StatPearls, Femoral Triangle). Iliacus and psoas major are drawn as one panel. Was labelled `hip_adductors` before 2026-10-17; the adductors arise from the pubis, not the hip bone. |
| `hip_adductors` | Hip adductors (inner thigh) | adductors | yes | 4 | partly verified | The small front panel on the inner thigh beside the vastus medialis, and the rear ovals (adductor magnus / gracilis). Pectineus and adductor longus form the medial floor of the femoral triangle (StatPearls). The drawing cannot separate pectineus, adductor longus, gracilis and magnus, so the label stays a group. |
| `rectus_femoris` | Rectus femoris | quadriceps | yes | 2 | partly verified | Central quadriceps head. The drawing shows one large oval that merges it with much of the vastus lateralis. |
| `vastus_lateralis` | Vastus lateralis | quadriceps | yes | 2 | source-backed | Outer quadriceps head, drawn as a thin outer strip. |
| `vastus_medialis` | Vastus medialis | quadriceps | yes | 2 | source-backed | Inner quadriceps head, the teardrop above the knee. |
| `tibialis_anterior` | Tibialis anterior | shins | yes | 2 | source-backed | Most superficial, medial muscle of the anterior leg. |
| `fibularis_group` | Fibularis (peroneal) group | shins | yes | 2 | source-backed | Lateral leg compartment, fibularis longus superficial. |
| `gastrocnemius` | Gastrocnemius | calves | yes | 6 | source-backed | Rear medial and lateral heads; the front medial head bulges into the front view. |
| `soleus` | Soleus | calves | yes | 6 | partly verified | Rear slivers beside the calf match a superficial soleus in the posterior compartment below the gastrocnemius (Wikipedia). The front lower-shin strips are not confirmed by any source read: the soleus is a posterior-compartment muscle. The broad rear panel below the gastrocnemius heads (`soleus-02`, subregion `lower_central`, added 2026-10-17) is the soleus above its junction with the Achilles tendon: the tendon narrows from about 6.6 cm where it meets the gastrocnemius to about 2.9 cm where it meets the soleus (Open Orthopaedics Journal cadaveric study), so the panel was split at its narrowest point. |
| `erector_spinae` | Erector spinae / lower back | lower_back | yes | 2 | likely | Group label for the muscles beside the spine. |
| `gluteus_medius` | Gluteus medius | glutes | yes | 2 | likely | Upper outer gluteal. |
| `gluteus_maximus` | Gluteus maximus | glutes | yes | 2 | likely | Large gluteal mass. |
| `biceps_femoris` | Biceps femoris | hamstrings | yes | 2 | source-backed | Lateral hamstring. |
| `medial_hamstrings` | Medial hamstrings | hamstrings | yes | 2 | source-backed | Semitendinosus (and the deeper semimembranosus) on the medial side; merged into one group label. |
| `patella_region` | Patella / front knee | joints | no | 2 | likely | Kneecap; joint region, not a muscle. |
| `popliteal_region` | Back of knee (popliteal region) | joints | no | 2 | source-backed | Hollow behind the knee bordered by the hamstrings and gastrocnemius heads; contents are nerves, vessels and fat, so not a muscle. |
| `iliotibial_tract` | Iliotibial band region | connective_tissue | no | 2 | likely | Fascia on the outer thigh, not a muscle. |
| `achilles_tendon` | Achilles tendon region | connective_tissue | no | 2 | likely | Narrow lower part of the central calf shape, from the soleus junction (the shape's narrowest point) to the heel; a tendon, not a muscle. The broad upper part is now the soleus. |
| `patellar_tendon_region` | Patellar tendon / upper shin region | connective_tissue | no | 2 | partly verified | The patellar tendon runs from the patella to the tibial tuberosity and is visible below the kneecap (Wikipedia). The drawn panel is a thin crescent below the kneecap, so its placement fits; it is a tendon, not a muscle. |

## References

See [SOURCES.md](SOURCES.md). Pages used for this review: Geeky Medics (back, lower leg), Kenhub (neck, forearm), StatPearls and TeachMeAnatomy (thigh, arm), Hithera (shoulder), Wikipedia (lumbar triangle), and NSW Health posterior-thigh notes.

Corrections backed by a source are welcome; see the README.
