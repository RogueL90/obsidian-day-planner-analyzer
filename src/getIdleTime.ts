import { TimeBlock } from './parseFile'
const getIdleTime = (schedule: TimeBlock[], totalTime: number): number => {
    let totalPlannedTime: number = 0
    let currStart = 0
    let reach = 0
    for(const timeblock of schedule){
        // Reach variable to handle overlapping time intervals
        if(timeblock.startTime<reach){
            reach = Math.max(reach, timeblock.endTime)
        }
        else{
            totalPlannedTime += reach -currStart
            currStart = timeblock.startTime
            reach = timeblock.endTime
        }
    }
    totalPlannedTime +=reach-currStart
    return totalTime - totalPlannedTime
}

export default getIdleTime