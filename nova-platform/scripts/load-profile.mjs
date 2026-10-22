// Shared deterministic cohort allocation: all workers together keep each channel balanced.
export function cohortSize(total,cohort,cohorts){
 if(!Number.isInteger(total)||total<1||!Number.isInteger(cohorts)||cohorts<1||!Number.isInteger(cohort)||cohort<0||cohort>=cohorts)throw new Error('Invalid viewer cohort');
 return Math.max(0,Math.ceil((total-cohort)/cohorts));
}
export function cohortChannel(index,streams,cohort=0,cohorts=1){return (index*cohorts+cohort)%streams;}
export function fixtureStreamCount(value='4'){
 const count=Number(value);if(!Number.isInteger(count)||count<1||count>5)throw new Error('NOVA_LOAD_STREAMS must be an integer from 1 to 5');return count;
}
