import mapboxgl from "mapbox-gl";
import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import * as turf from '@turf/turf';
import { lineString } from '@turf/helpers'
import { locationType } from "./enums";

mapboxgl.accessToken = import.meta.env.VITE_MAP_KEY as string;
const TFL_BASE_URL = "https://api.tfl.gov.uk"

const lineIdColourMap: { [key: string]: string } = {
    "bakerloo": "#B36305",
    "central": "#E32017",
    "circle": "#FFD300",
    "district": "#00782A",
    "hammersmith-city": "#F3A9BB",
    "jubilee": "#A0A5A9",
    "metropolitan": "#9B0056",
    "northern": "#000000",
    "piccadilly": "#003688",
    "victoria": "#00A0E2",
    "waterloo-city": "#95CDBA"
};

const stationNameCoordinateMap: {[key: string]: number[] } = {};
const lineIdTurfLineStringMap: {[key: string]: any} = {};
const lineIdStationNamesMap: {[key: string]: Set<string>} = {};

const  containsSubstring = (fullString: string, subString: string): boolean =>{
  // Escape special regex characters in the substring
  const escapedSubString = subString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Create a regex to check if fullString contains subString
  const regex = new RegExp(escapedSubString, 'i'); // 'i' for case-insensitive
  
  return regex.test(fullString);
}
const getTurfLineStringFromStations = (
    stationA: string,
    stationB: string,
    lineIdTurfLineStringMap: {[key: string]: any}, 
    lineIdStationNamesMap: {[key: string]: Set<string> }) =>{
        for(const lineId of Object.keys(lineIdStationNamesMap)){
            let found = false;
            let stationACoord: number[] = [];
            for(const stationName of lineIdStationNamesMap[lineId]){
                if(containsSubstring(stationName, stationA)){
                    found = true;
                    stationACoord = stationNameCoordinateMap[stationName];
                }
            }
            for(const stationName of lineIdStationNamesMap[lineId]){
                if(containsSubstring(stationName, stationB) && found) return {
                    turfLineString: lineIdTurfLineStringMap[lineId],
                    stationACoord: stationACoord,
                    stationBCoord: stationNameCoordinateMap[stationName]
                }
            }
        }
    }


const getTubeLines = async()=>{
    const request = await fetch(`${TFL_BASE_URL}/Line/Mode/tube?app_key=${import.meta.env.VITE_TFL_API_KEY as string}`);
    const response = await request.json();
    return response;
    
    
}

const getLineGeometry = async(id: string)=>{
    const request = await fetch(`${TFL_BASE_URL}/Line/${id}/Route/Sequence/outbound`);
    const response = await request.json();
    return response;
}

const getArrivals = async(id: string)=>{
    const request = await fetch(`${TFL_BASE_URL}/line/${id}/arrivals`);
    const response = await request.json();
    return response;
}

const parseCurrentLocation = (currentLocation: string, stationName?: string)=>{
    let match;
    if(match = currentLocation.match(/Between (.+?) and (.+)/)){
        return {
            type: locationType.BETWEEN,
            stationA: match[1],
            stationB: match[2]
        }
    }

    if(currentLocation === "At Platform"){
        return { type: locationType.AT_PLATFORM, station: stationName };
    }

    if(match = currentLocation.match(/^At (.+)/)){
        return { type: locationType.AT, station: match[1] };
    }

    if(match = currentLocation.match(/Approaching (.+)/)){
        return { type: locationType.APPROACHING, station: match[1] };
    }

    if(match = currentLocation.match(/Leaving (.+)/)){
        return { type: locationType.LEAVING, station: match[1] };
    }

    if (match = currentLocation.match(/Left (.+)/)) {
        return { type: locationType.LEFT, station: match[1] };
    }

    if (match = currentLocation.match(/Departed (.+)/)) {
        return { type: locationType.DEPARTED, station: match[1] };
    }
  
    // Unknown format - log it for debugging
    console.warn('Unknown currentLocation format:', currentLocation);
    return null;
}

export default function Map(){
    const mapContainerRef = useRef<HTMLDivElement | null>(null);

    useEffect(()=>{
        if(!mapContainerRef.current) return;

        const map = new mapboxgl.Map({
            container: mapContainerRef.current,
            style: "mapbox://styles/mapbox/streets-v12",
            center: [-0.1276, 51.5072], //this is London
            zoom: 15,
            pitch: 60, //tilt the camera for 3d... we should play with this
            bearing: -20,
            antialias: true, //apparently this gives better rendering for 3d
        });

        // add navigation controls
        map.addControl(new mapboxgl.NavigationControl(), "top-right");
        map.on("load", async ()=>{
            //we are getting the data in load first so we can 
            //have all data before we start building the map
            const stationData: any[] = [];
            const tubeLines = await getTubeLines(); //get all tube lines
            const promises = tubeLines.map(async (tube: any) =>{
                const geometry = await getLineGeometry(tube.id);
                const coordinates = geometry.lineStrings.map((ls: string) => JSON.parse(ls));
                //lineStrings is a list of a list of 2d arrays... we change every element in that
                //list into its parsed version cause they are strings initially
                stationData.push(geometry.stations);

                return {
                    id: tube.id,
                    color: lineIdColourMap[tube.id],
                    coordinates: coordinates
                }
            });

            const results = await Promise.all(promises);
            stationData.flat().forEach((station: any)=>{
                stationNameCoordinateMap[station.name] = [station.lon, station.lat];
            });

            console.log("Station Name - Coordinate Map -> ", stationNameCoordinateMap);

            map.addLayer({
                id: "3d-buildings",
                source: "composite",
                "source-layer": "building",
                filter: ["==", "extrude", "true"],
                type: "fill-extrusion",
                minzoom: 15,
                paint: {
                  "fill-extrusion-color": "#aaa",
                  "fill-extrusion-height": ["get", "height",],
                  "fill-extrusion-base": ["get", "min_height"],
                  "fill-extrusion-opacity": 0.6  
                }  
            });

            //we are adding the lines and stops
            for(const line of results){
                //flat turns [[a,b], [c, d]] => [a,b,c,d]
                const stationsFeatures = line.coordinates.flat().flatMap((coordinateList: any)=>{
                    return coordinateList.map((coordinate: any)=>{

                        return {
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: coordinate },
                            properties: { line: line.id }
                        };
                    });
                    
                });


                map.addSource(`${line.id}-stations-source`, {
                    type: 'geojson',
                    data: {
                        type: "FeatureCollection",
                        features: stationsFeatures
                    }
                });

                map.addLayer({
                    id: `${line.id}-stations-layer`,
                    type: 'circle',
                    source: `${line.id}-stations-source`,
                    paint: {
                        'circle-radius':10,
                        'circle-color': line.color,
                        'circle-stroke-width': 10,
                        'circle-stroke-color': '#fff',
                    }
                }, '3d-buildings');

            for(let i = 0; i<line.coordinates.length; ++i){
                console.log("printing from tube line data array -> ", line.coordinates[i]);
                //so the coordinates are an array of an array of [lat, long] pairs
                //buuut we have only one array of [lat, long] pairs in our array of arrays
                const id = `${line.id}-line-${i}`
                console.log(`Adding Source -> ${id}`);
                map.addSource(id, {
                type: "geojson",
                data: {
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: line.coordinates[i].flat()
                    },
                    properties: {}
                }
                });
                const turfLineString = turf.lineString(line.coordinates[i].flat());
                lineIdTurfLineStringMap[id] = turfLineString;
                //we want to get line id to the various stops as well 
                //So we can loop through the coordinates and the stationNameCoordinatesMap get the names of the stops 
                //inefficient I know
                
                lineIdStationNamesMap[id] = new Set<string>();
                for(const [long, lat] of line.coordinates[i].flat()){
                    for(const stationName of Object.keys(stationNameCoordinateMap)){
                        const stationLong = stationNameCoordinateMap[stationName][0];
                        const stationLat = stationNameCoordinateMap[stationName][1];

                        if(long === stationLong && lat === stationLat) lineIdStationNamesMap[id].add(stationName);
                    }
                }

                console.log(`Adding Line Layer -> ${line.id}-line-${i}`);
                map.addLayer({
                    id: `${line.id}-line-layer-${i}`,
                    type: "line",
                    source: `${line.id}-line-${i}`,
                    layout: {
                        "line-cap": "round",
                        "line-join": "round"
                    },
                    paint: {
                        "line-color": line.color,
                        "line-width": [
                            'interpolate', //smooth transitions between line widths when we zoom,
                            ['linear'], //interpolation type
                            ['zoom'], //the input variable... current zoom level
                            10, 10, //at zoom 10, let the width be 3
                            14, 20, //at zoom 14 let the width be 8
                        ],
                        'line-opacity': 0.25
                    }
                });
                
            }

            console.log('LineIdStationNamesMap -> ', lineIdStationNamesMap);

            //now we get the train positions
            const arrivalDataArray: { currentLocation: string, station: string, towards: string }[] = [];
            for(const lineId of Object.keys(lineIdColourMap)){
                const arrivalData: any[] = await getArrivals(lineId);
                arrivalData.forEach((data)=>{
                    arrivalDataArray.push({
                        currentLocation: data.currentLocation, 
                        station: data.stationName,
                        towards: data.towards
                    });
                });
            }

            //get train coordinates
            for(const data of arrivalDataArray){
                const currentLocationData = parseCurrentLocation(data.currentLocation, data.station);
                if(!currentLocationData) continue;
                switch(currentLocationData.type){
                    case locationType.BETWEEN:
                        const betwenResult = getTurfLineStringFromStations(currentLocationData.stationA!, currentLocationData.stationB!, lineIdTurfLineStringMap, lineIdStationNamesMap);
                        //const point = turf.along()
                        console.log('Between result -> ', betwenResult);
                        break;
                }
            }


        }
        });

        

        return ()=> map.remove();
    }, []);

    return <div ref={mapContainerRef} style={{ width: "100vw", height: "100vh"}}/>
}