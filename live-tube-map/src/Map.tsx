import mapboxgl from "mapbox-gl";
import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";


console.log("MAP TOKEN:", import.meta.env.VITE_MAP_KEY);

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

interface tubeLineData {
    id: string, 
    color: string,
    coordinates: number[][][]
};

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
export default function Map(){
    const mapContainerRef = useRef<HTMLDivElement | null>(null);

    useEffect(()=>{
        const tubeLineDataArray: tubeLineData[] = [];
        //we are assuming everything is fine here 
        //not much error handling
        getTubeLines().then((data)=>{
            for(const tubeData of data){
                const data: tubeLineData  = {
                    id: tubeData.id,
                    color: lineIdColourMap[tubeData.id], 
                    coordinates: []
                };

                getLineGeometry(tubeData.id).then((tubeLineData)=>{
                    console.log(tubeLineData.lineStrings);
                    for(const lineStrings of tubeLineData.lineStrings){
                        const lineData : number[][][] = JSON.parse(lineStrings);
                        data.coordinates = lineData;
                        console.log("parsed line data -> ", lineData);
                    }
                    
                });
                tubeLineDataArray.push(data);
                console.log(data);
                console.log(`Processed ${tubeData.id}`);
            }
        });
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
        map.on("load", ()=>{
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

            for(const line of tubeLineDataArray){
            for(let i = 0; i<line.coordinates.length; ++i){
                console.log("printing from tube line data array -> ", line.coordinates[i]);
                map.addSource(`${line.id}-line-${i}`, {
                type: "geojson",
                data: {
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: line.coordinates[i]
                    },
                    properties: {}
                }
                });

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
                        "line-width": 4
                    }
                });
            }
        }
        });

        

        return ()=> map.remove();
    }, []);

    return <div ref={mapContainerRef} style={{ width: "100vw", height: "100vh"}}/>
}