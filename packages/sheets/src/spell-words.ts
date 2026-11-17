/*
 * A small list of common English words, so that the spelling check works out of the box. It is deliberately short: a real
 * dictionary (Hunspell's en_US, say, or your own product terms) is passed in by the host (`new SpellChecker(words)`).
 * Plurals, `-ed`, `-ing`, `-ly`, `-er` and `-est` forms are accepted from the base words by the checker's suffix rules.
 */
export const COMMON_WORDS: string = `
a able about above account across act action add address after again against age ago agree air all allow almost alone along
already also always am among amount an and annual another answer any appear apply april are area around as ask at august
average away back bad balance bank base be because become been before begin behind being believe below best better between
big bill black blue board body book both box budget build business but buy by call came can capital car card care carry case
cash cause cell center centre certain change charge check city class clear close code cold color colour come common company
compare complete cost could count country course cover create credit current customer cut daily data date day deal dear
december decide deep department detail did different do does done double down draft draw drive during each early east easy
effect eight either else employee end enough entry equal error even evening ever every example expense eye face fact fall
family far fast father feb february few field figure file fill final finance find fine finish first five fix floor follow
food for force form format forward found four free friday from front full fund future gain game gave general get give go
goal going gone good got great green gross group grow had half hand happen hard has have he head hear help her here high him
his hold home hour house how however hundred i idea if important in include income increase index information input inside
instead into is issue it item its january job join july june just keep kind know label large last late law lead learn least
leave left length less let letter level life light like limit line list little local long look loss lost lot low made mail
main make man manager many march mark market match may maybe me mean measure meet member message middle might mile million
mind minute miss model monday money month more morning most mother move much must my name national near need net never new
next night nine no none noon north not note nothing november now number october of off offer office often oh old on once one
only open or order other our out output over own page paid paper part pay people per percent period person pick place plan
plant play please plus point policy position possible pound power present price print private problem process product profit
program project public put quarter question quick quite rate rather read ready real reason receive record red region
report result return revenue right rise road room round row rule run sale sales same saturday save say second section see
seem sell send sense september service set seven several share she sheet shop short should show side sign simple since single
six size small so some something sometimes soon sort south space speak special spend spent square staff stand start state
status stay step still stock stop store story street strong study subject such sum summary sunday supply support sure system
table take talk task tax team ten term test than thank that the their them then there these they thing think third this those
though thousand three through thursday time title to today together told too top total toward town trade true try tuesday
turn two type under unit until up upon us use used user usual value various very view visit wait walk want was water way we
wednesday week weight well went were west what when where whether which while white who whole whose why wide will window
with within without woman word work world would write wrong year yes yet you young your zero
accept access achieve activity actual adjust admin advance advice agency agent agreement amend analysis annually apple
application approve approved april archive arrange article asset assign assume attach attend audit author available award
bar basic basis batch benefit billing blank block bonus bottom brand branch break bring brown budget bulk buyer calculate
calendar campaign cancel category center chain chair channel chart choose circle claim client coffee collect column combine
comment commit communicate complete concept condition confirm connect consider contact content contract control copy correct
cost counter credit criteria cumulative currency custom cycle dashboard database deadline debit default delay deliver
delivery demand describe description design desk device difference digital direct director discount display distribute
divide document dollar domain download due duplicate duration edit effective email enable engine enter environment equity
estimate event exact exchange exclude execute exist expect expire export extra factor fail failure feature fee feedback
filter finish fiscal fixed flag flat flow focus folder forecast formula freeze frequency function funding gap generate
global grade grant graph grid growth guide handle header health history hold holiday hotel hourly identify image impact
import improve inactive incoming individual industry initial insert install instance insurance interest internal invoice
issue join journal keyboard key label language laptop launch layout ledger legal letter library license line link load
location lock login logo lookup loop machine maintain manage manual margin master material maximum meeting memo menu merge
method metric minimum mobile module monitor monthly motor name network normal notice object office online operation option
order organization original outcome output overdue overview owner package panel parent partner password past patch payment
payroll pending percentage performance permission phone photo pilot pipeline plain platform policy portal portfolio postal
preview previous primary priority produce production professional progress promote property proposal protect provide
purchase purpose quality quantity query queue quote range ratio raw reach rebate receipt recent recommend reconcile reduce
reference refresh refund register regular related release remain remark remind remove rent repair repeat replace reply
request require reserve reset resource response restore retail review reward risk role route sample scale schedule scope
score screen search secure select sequence server session setting setup shipping shortcut signature similar site software
solution source spread stage standard statement storage strategy structure submit subscribe success supplier survey switch
symbol target template tender text theme ticket timeline tool topic track training transaction transfer travel trend
update upgrade upload urgent usage utility validate variable variance vendor version video visible volume warning
website weekly welcome wire worksheet workbook yearly
east west north south january february march april june july august september october november december
mon tue wed thu fri sat sun
`;
